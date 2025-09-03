/**
 * ID generation utilities compatible with TigerBeetle's recommended ID scheme
 * Based on src/clients/node/src/index.ts id() function
 */

import { crypto } from "@std/crypto";

let idLastTimestamp = 0;

// Buffer to store the last generated ID components
// Layout: 80 bits random (10 bytes) + 48 bits timestamp (6 bytes) = 128 bits (16 bytes)
const idBuffer = new ArrayBuffer(16);
const idView = new DataView(idBuffer);
const idArray = new Uint8Array(idBuffer);

/**
 * Generates a Universally Unique and Sortable Identifier as a u128 bigint.
 * 
 * Compatible with TigerBeetle's recommended ID scheme:
 * - 48 bits of timestamp (high-order bits) 
 * - 80 bits of randomness (low-order bits)
 * 
 * IDs are guaranteed to be monotonically increasing within the same millisecond.
 * 
 * @returns A 128-bit ID as a bigint
 */
export function id(): bigint {
  // Ensure timestamp monotonically increases
  let timestamp = Date.now();
  if (timestamp <= idLastTimestamp) {
    timestamp = idLastTimestamp;
  } else {
    idLastTimestamp = timestamp;
    // Generate new random bytes when timestamp advances
    crypto.getRandomValues(idArray.subarray(0, 10)); // 80 bits of randomness
  }

  // Increment the 80-bit random value for monotonicity within the same millisecond
  const littleEndian = true;
  
  // Increment using carry arithmetic across 32-bit chunks
  let carry = 1;
  for (let offset = 0; offset < 10 && carry; offset += 4) {
    const chunkSize = Math.min(4, 10 - offset);
    if (chunkSize === 4) {
      const value = idView.getUint32(offset, littleEndian) + carry;
      idView.setUint32(offset, value & 0xFFFFFFFF, littleEndian);
      carry = value > 0xFFFFFFFF ? 1 : 0;
    } else {
      // Handle remaining bytes
      let value = 0;
      for (let i = 0; i < chunkSize; i++) {
        value |= idArray[offset + i] << (i * 8);
      }
      value += carry;
      
      for (let i = 0; i < chunkSize; i++) {
        idArray[offset + i] = (value >> (i * 8)) & 0xFF;
      }
      carry = value >> (chunkSize * 8);
    }
  }

  if (carry) {
    throw new Error('Random bits overflow on monotonic increment');
  }

  // Store timestamp in the high-order 48 bits (bytes 10-15)
  // Layout matches Node.js client: timestamp (48 bits) in little-endian
  // Use BigInt arithmetic to avoid precision loss
  const timestampBig = BigInt(timestamp);
  const timestampLo = Number(timestampBig & 0xFFFFn); // low 16 bits
  const timestampHi = Number((timestampBig >> 16n) & 0xFFFFFFFFn); // high 32 bits
  
  idView.setUint16(10, timestampLo, littleEndian);
  idView.setUint32(12, timestampHi, littleEndian);

  // Convert buffer to big-endian u128 bigint
  // TigerBeetle stores IDs with timestamp as high-order bits for sorting
  const lo = idView.getBigUint64(0, littleEndian); // random bits (low)
  const hi = idView.getBigUint64(8, littleEndian); // random+timestamp bits (high)
  
  return (hi << 64n) | lo;
}

/**
 * Parse a TigerBeetle ID to extract timestamp and random components
 * 
 * @param id The 128-bit ID as a bigint
 * @returns Object with timestamp (ms) and random components
 */
export function parseId(id: bigint): { timestamp: number; random: bigint } {
  // Extract components - timestamp is in high 48 bits
  const lo = id & ((1n << 64n) - 1n);
  const hi = id >> 64n;
  
  // Reconstruct the little-endian layout
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  
  view.setBigUint64(0, lo, true);
  view.setBigUint64(8, hi, true);
  
  // Extract timestamp from bytes 10-15 (48 bits) - matches Node.js layout
  const timestampLo = view.getUint16(10, true);
  const timestampHi = view.getUint32(12, true);
  
  // Reconstruct full 48-bit timestamp using BigInt to avoid precision issues
  const timestampBig = BigInt(timestampLo) | (BigInt(timestampHi) << 16n);
  const timestamp = Number(timestampBig);
  
  // Extract random from bytes 0-9 (80 bits)
  const randomLo = view.getBigUint64(0, true);
  const randomHi = view.getUint16(8, true);
  const random = randomLo | (BigInt(randomHi) << 64n);
  
  return {
    timestamp,
    random: random & ((1n << 80n) - 1n) // mask to 80 bits
  };
}

/**
 * Create an ID from timestamp and random components
 * Useful for testing or when you need specific timestamp values
 * 
 * @param timestamp Timestamp in milliseconds
 * @param random 80-bit random value (will be truncated if larger)
 * @returns 128-bit ID as bigint
 */
export function createId(timestamp: number, random: bigint = 0n): bigint {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  
  // Store random in bytes 0-9 (80 bits)
  const randomMasked = random & ((1n << 80n) - 1n);
  const randomLo = randomMasked & ((1n << 64n) - 1n);
  const randomHi = randomMasked >> 64n;
  
  view.setBigUint64(0, randomLo, true);
  view.setUint16(8, Number(randomHi), true);
  
  // Store timestamp in bytes 10-15 (48 bits) using BigInt for precision
  const timestampBig = BigInt(timestamp);
  const timestampLo = Number(timestampBig & 0xFFFFn);
  const timestampHi = Number((timestampBig >> 16n) & 0xFFFFFFFFn);
  
  view.setUint16(10, timestampLo, true);
  view.setUint32(12, timestampHi, true);
  
  // Convert to bigint with proper endianness
  const lo = view.getBigUint64(0, true);
  const hi = view.getBigUint64(8, true);
  
  return (hi << 64n) | lo;
}

/**
 * Validate that an ID conforms to TigerBeetle constraints
 * - Must not be zero
 * - Must not be u128 max value
 * 
 * @param id The ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidId(id: bigint): boolean {
  return id > 0n && id < ((2n ** 128n) - 1n);
}
# `db tokens create`

You can create a new token that can be used to connect to one database using the command:

```sh
turso db tokens create <database-name> [flags]
```

## Flags

| Flag                 | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| `-e`, `--expiration` | The expiration time for a token, can be `never` or a value in days, e.g. `7d`. |
| `-r`, `--read-only`  | Restrict the token to read only access.                                        |

## Examples

The examples below outline the most common use cases for the `db tokens create` command.

### Create a token with read only access

You can create a token with read only access to a database using the following command:

```sh
turso db tokens create <database-name> --read-only
```

### Create a token with a specific expiration time

You can create a token with a specific expiration time using the following command:

```sh
turso db tokens create <database-name> --expiration 7d3h2m1s
```

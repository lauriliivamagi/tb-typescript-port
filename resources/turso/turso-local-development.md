# Local Development

Build locally using SQLite, libSQL Server or Turso.

Developers can build locally with Turso using either of the following methods:

| Method                                | Description                   | Use Case                                                        |
| :------------------------------------ | :---------------------------- | :-------------------------------------------------------------- |
| [**SQLite**](#sqlite)                 | A local SQLite database file  | Simple local development without libSQL-specific features.      |
| [**Turso CLI**](#turso-cli)           | A managed local libSQL server | Development requiring libSQL-specific features like extensions. |
| [**Turso Database**](#turso-database) | A remote Turso database       | Using an existing cloud database for development.               |

## Using a dump locally

You can always dump your production database and use it locally for development:

1.  **Create a dump using the Turso CLI**

    ```sh
    turso db shell your-database .dump > dump.sql
    ```

2.  **Create SQLite file from dump**

    ```sh
    cat dump.sql | sqlite3 local.db
    ```

3.  **Connect to SQLite file**

    You can use any of the methods below with the `local.db` file, or you can use a new file name if you prefer to create a database from scratch.

## SQLite

There are a few things to keep in mind when using SQLite for local development:

- Doesn’t have all the features of libSQL
- Works with non-serverless based Turso SDKs

When working with an [SDK](https://docs.turso.tech/sdk), you can pass it a `file:` URL to connect to a SQLite database file instead of a remote Turso database:

```javascript
import { createClient } from "@libsql/client";

const client = createClient({
  url: "file:local.db",
});
```

You don’t need to provide an `authToken` in development.

It’s recommended to use environment variables for both `url` and `authToken` for a seamless developer experience.

## Turso CLI

If you’re using [libSQL](https://docs.turso.tech/libsql) specific features like [extensions](https://docs.turso.tech/libsql#extensions), you should use the Turso CLI to start a local server:

```sh
turso dev
```

This will start a local libSQL server and create a database for you. You can then connect to it using the `url` option in your SDK:

```javascript
import { createClient } from "@libsql/client";

const client = createClient({
  url: "http://127.0.0.1:8080",
});
```

Changes will be lost when you stop the server.

If you want to persist changes, or use a production dump, you can pass the `--db-file` flag with the name of the SQLite file:

```sh
turso dev --db-file local.db
```

## Turso Database

If you already have a database created with Turso, you can use that same one in development by passing the `url` and `authToken` to your SDK.

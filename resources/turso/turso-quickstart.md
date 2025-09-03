# Turso Quickstart (TypeScript / JS)

Get started with Turso and TypeScript using the libSQL client in a few simple steps

In this JavaScript quickstart we will learn how to:

- Retrieve database credentials
- Install the JavaScript libSQL client
- Connect to a remote Turso database
- Execute a query using SQL

Retrieve database credentials

You will need an existing database to continue. If you don’t have one, [create one](https://docs.turso.tech/quickstart).Get the database URL:

```
    turso db show --url <database-name>
```

Get the database authentication token:

```
    turso db tokens create <database-name>
```

Assign credentials to the environment variables inside `.env`.

```
    TURSO_DATABASE_URL=
    TURSO_AUTH_TOKEN=
```

You will want to store these as environment variables.

Install `@libsql/client`

Begin by installing the `@libsql/client` dependency in your project:

```
    deno add npm:@libsql/client
```

Initialize a new client

Next add your database URL and auth token:

```deno
    import { createClient } from "https://esm.sh/@libsql/client@0.6.0/web";

    export const turso = createClient({
      url: Deno.env.get("TURSO_DATABASE_URL"),
      authToken: Deno.env.get("TURSO_AUTH_TOKEN"),
    });
```

Execute a query using SQL

You can execute a SQL query against your existing database by calling `execute()`:

```deno
    await turso.execute("SELECT * FROM users");
```

If you need to use placeholders for values, you can do that:

````deno
await turso.execute({
      sql: "INSERT INTO users VALUES (:name)",
      args: { name: "Iku" },
    });```
````

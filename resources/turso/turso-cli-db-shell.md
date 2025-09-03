# db shell

You can connect directly to a Turso database by using the following command:

```sh
turso db shell <database-name> [sql [flags]
```

````

## Flags

| Flag                    | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `--instance <instance>` | Connect to the specified database instance.        |
| `--location <location>` | Connect to the database at the specified location. |
| `--proxy <url>`         | The proxy to use when connecting to the database.  |

## Examples

### Execute SQL

You can execute SQL directly against a database using the shell:

```sh
turso db shell <database-name> "SELECT * FROM users"
```

### Database dump

You can dump the contents of a Turso database using the following command:

```sh
turso db shell <database-name> .dump > dump.sql
```

The `.dump` can be used to rebuild a database and doesn’t contain any libSQL or SQLite internal tables.

### Load from dump

You can load a dump file into a new database using the following command:

```sh
turso db shell <database-name> < dump.sql
```

### Shell with libSQL server

If you’re using `turso dev` locally, you can use the shell by providing the URL to your database:

```sh
turso db shell http://127.0.0.1:8080
```
````

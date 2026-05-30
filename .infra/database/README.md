# godlife local database

Local PostgreSQL and Flyway setup lives under `.infra`.

## Commands

```bash
make container-up
make flyway-migrate
make container-ps
make container-down
```

## Defaults

- PostgreSQL image: `postgres:18`
- Database: `godlife`
- User: `godlife`
- Local port: `5432`
- Flyway migration directory: `.infra/database/migration`

Add migrations using Flyway's configured naming format:

```text
v0.0.1__description.sql
```

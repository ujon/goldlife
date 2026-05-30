# godlife local database

Local PostgreSQL and Flyway setup lives under `.infra`.

## Commands

```bash
make container-up
make server-dev
make flyway-migrate
make container-ps
make container-down
```

## Defaults

- PostgreSQL image: `postgres:18`
- Database: `sai`
- User: `sai`
- Local port: `5432`
- App URL: `http://127.0.0.1:5174`
- App `DATABASE_URL`: `postgres://sai:sai@127.0.0.1:5432/sai`
- Flyway migration directory: `.infra/database/migration`
- Flyway schema: `public`

Add migrations using Flyway's configured naming format:

```text
v0.0.1__description.sql
```

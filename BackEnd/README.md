# AssetTrack backend

## XAMPP setup

1. Start **MySQL** in the XAMPP Control Panel.
2. Open phpMyAdmin and import [`schema.sql`](schema.sql). It creates the `assettrack` database, authentication tables, indexes, foreign keys, and starter categories/locations. If you already imported the older schema, import [`auth-migration.sql`](auth-migration.sql) once, then import [`assettrack-feature-migration.sql`](assettrack-feature-migration.sql) to add tags, QR support, history, audit, depreciation, and maintenance fields.
3. Install Node.js, then run these commands from the `BackEnd` folder:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

The application is served at `http://localhost:3000`. Open that URL rather than opening `FrontEnd/index.html` directly, because the frontend uses the backend `/api` routes. On Windows PowerShell where script execution is restricted, use `npm.cmd` in place of `npm`.

If the MySQL root account has a password, set it in `.env` as `DB_PASSWORD`. Change `DB_HOST`, `DB_PORT`, or `DB_NAME` there when using a non-default XAMPP configuration.

## Authentication

The first registration becomes the initial `admin` account. After that, only an authenticated admin can register more users. Passwords are stored as salted Node.js `scrypt` hashes, never as plain text. Sessions are random tokens stored as hashes in MySQL, expire after eight hours, and are revoked when the user logs out.

Role permissions are enforced by the backend. Admins have full access and can create users, assets, and maintenance records. Managers / Supervisors can see dashboards and audit logs and approve retirement, but cannot delete records. Staff / Encoders can update operational asset fields and mark maintenance complete, but cannot delete assets, view audit logs, or view financial values. Viewers / Auditors have read-only access to reports, financial values, and audit logs. The frontend hides controls as a convenience; the backend middleware is the actual security boundary.

## API

- `GET /api/health` checks the database connection.
- `GET /api/dashboard` returns metrics and recent activity.
- `GET|POST|PUT|DELETE /api/assets` manages assets.
- `GET|POST|PUT|DELETE /api/maintenance` manages maintenance records.
- `GET /api/options` returns categories, locations, and staff for forms.
- `GET /api/users` lists users for admins.
- `GET /api/audit` returns the audit history.
- `POST /api/assets/:id/approve-retirement` approves retirement for managers/admins.
- `POST /api/maintenance/:id/complete` lets staff/admins log maintenance completion.

Asset and maintenance writes use parameterized SQL, foreign keys, validation, transactions where multiple writes are needed, and audit records.
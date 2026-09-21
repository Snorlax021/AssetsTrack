# AssetTrack backend

## XAMPP setup

1. Start **MySQL** in the XAMPP Control Panel.
2. Open phpMyAdmin and import [`schema.sql`](schema.sql). It is the complete database setup: authentication, assets, maintenance, location history, audit logs, depreciation fields, indexes, foreign keys, and starter categories/locations. For an existing installation created from an older schema, back up the database first and apply the required changes manually before using this consolidated schema.
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

Role permissions are enforced by the backend. Admins have full access and can manage users, assets, and maintenance records. Managers / Supervisors can see dashboards and audit logs, approve maintenance and retirement, update operational asset fields, and view financial reports, but cannot manage users or delete records. Staff / Encoders can view and update only assigned assets, update location and condition, and mark assigned maintenance complete; they cannot view audit logs or financial values. New registrations remain pending until an admin approves them. The frontend hides controls as a convenience; the backend middleware is the actual security boundary.

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
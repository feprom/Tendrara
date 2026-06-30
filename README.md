# Tendrara Micro LNG — Training Registration

Static registration site for the **Tendrara Micro LNG Facilities** training program.

- **Vendor:** Technical America · **Clients:** Mana Energy, ITF
- **Backend:** Supabase (registration writes go through the `register_trainee` RPC).

## Contents
```
index.html            Welcome + registration form (+ confirmation page)
supabase-config.js    Supabase URL + publishable key (safe to expose; RLS protects data)
images/               Brand logos
.nojekyll             Serve files as-is (no Jekyll processing)
```

## Deploy (GitHub Pages)
1. Push these files to the repository root (e.g. `main` branch).
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, Folder = `/ (root)`.
3. The form will be live at `https://<user>.github.io/<repo>/`.

> Only the public website lives here. Engineering source documents, SQL migrations,
> content chunks and project notes are kept **out** of this repository.

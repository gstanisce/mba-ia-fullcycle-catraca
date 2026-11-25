import { html, type SafeHtml } from './html.js';

export type Role = 'organizer' | 'participant';

/** The logged-in user as seen by request handlers (`request.user`). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LayoutOptions {
  title: string;
  user: SessionUser | null;
  body: SafeHtml;
  /** Optional flash/status message shown above the page body (escaped). */
  status?: string;
}

function nav(user: SessionUser | null): SafeHtml {
  const links: SafeHtml[] = [html`<a href="/">Vitrine</a>`];
  if (user?.role === 'participant') links.push(html`<a href="/my-tickets">Meus ingressos</a>`);
  if (user?.role === 'organizer') links.push(html`<a href="/organizer">Área do organizador</a>`);
  if (user) {
    links.push(html`<span class="user">${user.name}</span>`);
    links.push(html`<form method="post" action="/logout" class="inline"><button type="submit">Sair</button></form>`);
  } else {
    links.push(html`<a href="/login">Entrar</a>`, html`<a href="/signup">Criar conta</a>`);
  }
  return html`<nav>${links.map((l) => html`${l} `)}</nav>`;
}

/** Full HTML document with the role-aware navigation bar. */
export function layout({ title, user, body, status }: LayoutOptions): string {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Catraca</title>
<style>
body{font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:1rem;line-height:1.4}
nav{display:flex;gap:1rem;align-items:center;border-bottom:1px solid #ccc;padding-bottom:.5rem;margin-bottom:1rem;flex-wrap:wrap}
form.inline{display:inline;margin:0}
.error{color:#b00020;font-weight:600}
label{display:block;margin:.5rem 0}
</style>
</head>
<body>
${nav(user)}
<main>
${status ? html`<p class="status" role="status">${status}</p>` : ''}
${body}
</main>
</body>
</html>`.toString();
}

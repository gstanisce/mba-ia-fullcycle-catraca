import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw, SafeHtml } from '../src/lib/html.js';
import { newId, newTicketCode } from '../src/lib/ids.js';
import { layout } from '../src/lib/layout.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('html', () => {
  it('escapeHtml escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('html tag escapes interpolations but not SafeHtml', () => {
    const evil = '<script>alert(1)</script>';
    const out = html`<p>${evil}</p>${raw('<b>ok</b>')}${html`<i>${'&'}</i>`}`;
    expect(out).toBeInstanceOf(SafeHtml);
    expect(out.toString()).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><b>ok</b><i>&amp;</i>');
  });

  it('html tag concatenates arrays and drops null/undefined/false', () => {
    const items = ['a<', 'b'].map((s) => html`<li>${s}</li>`);
    expect(html`<ul>${items}</ul>${null}${undefined}${false}${0}`.toString()).toBe(
      '<ul><li>a&lt;</li><li>b</li></ul>0',
    );
  });
});

describe('ids', () => {
  it('newId has prefix + 10 base36 chars and is unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('usr')));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^usr_[0-9a-z]{10}$/);
  });

  it('newTicketCode has 8 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 1000; i++) expect(newTicketCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });
});

describe('password', () => {
  it('hashes in scrypt format and verifies', async () => {
    const hash = await hashPassword('segredo1');
    expect(hash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(hash).not.toContain('segredo1');
    expect(await verifyPassword('segredo1', hash)).toBe(true);
    expect(await verifyPassword('segredo2', hash)).toBe(false);
    expect(await verifyPassword('segredo1', 'garbage')).toBe(false);
  });

  it('uses a random salt', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });
});

describe('layout', () => {
  const body = html`<h1>Oi</h1>`;

  it('visitor nav: Vitrine, Entrar, Criar conta', () => {
    const page = layout({ title: 'T', user: null, body });
    expect(page).toContain('<!doctype html>');
    expect(page).toContain('href="/">Vitrine');
    expect(page).toContain('href="/login">Entrar');
    expect(page).toContain('href="/signup">Criar conta');
    expect(page).not.toContain('Sair');
  });

  it('participant nav: Meus ingressos, name, Sair; no organizer link', () => {
    const page = layout({ title: 'T', user: { id: 'u', name: 'Ana <x>', email: 'a@x.com', role: 'participant' }, body });
    expect(page).toContain('href="/my-tickets">Meus ingressos');
    expect(page).toContain('Ana &lt;x&gt;');
    expect(page).toContain('action="/logout"');
    expect(page).toContain('Sair');
    expect(page).not.toContain('Área do organizador');
    expect(page).not.toContain('Entrar');
  });

  it('organizer nav: Área do organizador; no Meus ingressos', () => {
    const page = layout({ title: 'T', user: { id: 'u', name: 'Org', email: 'o@x.com', role: 'organizer' }, body });
    expect(page).toContain('href="/organizer">Área do organizador');
    expect(page).not.toContain('Meus ingressos');
  });

  it('escapes the title and status', () => {
    const page = layout({ title: '<t>', user: null, body, status: '<s>' });
    expect(page).toContain('&lt;t&gt;');
    expect(page).toContain('&lt;s&gt;');
  });
});

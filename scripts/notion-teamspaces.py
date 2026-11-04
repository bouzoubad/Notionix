#!/usr/bin/env python3
"""Teamspaces of a Notion workspace, read from the Notion desktop app's cache.

Notion's public API does not say which teamspace a top-level page belongs
to; the Notion app on this Mac knows it. This writes, for the migration
(`node main.mjs notion-migrate … --teamspaces <file>`):

  {"teamspaces": [{"id", "name", "icon", "memberEmails", "pages", "unresolvedGroups"}],
   "users": [{"id", "email", "name"}]}

The people (with e-mails) are what a personal Notion token cannot list.

Usage: python3 scripts/notion-teamspaces.py "<Notion workspace name>" teamspaces.json

The app only keeps a teamspace's page list once it has shown it: open each
teamspace in the Notion app's sidebar first. The cache is copied, never
written.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

CACHE = os.path.expanduser('~/Library/Application Support/Notion/notion.db')


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    space_name, out = sys.argv[1], sys.argv[2]
    tmp = tempfile.mkdtemp()
    for suffix in ('', '-wal', '-shm'):
        if os.path.exists(CACHE + suffix):
            shutil.copy(CACHE + suffix, os.path.join(tmp, 'notion.db' + suffix))
    db = sqlite3.connect(os.path.join(tmp, 'notion.db'))
    space = db.execute('SELECT id FROM space WHERE name = ?', (space_name,)).fetchone()
    if not space:
        names = [r[0] for r in db.execute('SELECT DISTINCT name FROM space')]
        print(f'Espace Notion « {space_name} » introuvable ; connus : {", ".join(names)}')
        return 1
    space_id = space[0]
    emails = {r[0]: r[1] for r in db.execute('SELECT id, email FROM notion_user WHERE email IS NOT NULL')}
    people = {
        r[0]: {'id': r[0], 'email': r[1], 'name': r[2]}
        for r in db.execute('SELECT id, email, name FROM notion_user')
    }
    group_members: dict[str, set[str]] = {}
    for group, user in db.execute(
        'SELECT space_permission_group_id, user_id FROM space_permission_group_member WHERE removed_at IS NULL'
    ):
        group_members.setdefault(group, set()).add(user)
    group_names = {r[0]: r[1] for r in db.execute('SELECT id, name FROM space_permission_group')}

    teamspaces = []
    missing = []
    seen = set()
    for team_id, name, icon, pages, membership, archived in db.execute(
        'SELECT id, name, icon, team_pages, membership, archived_by FROM team WHERE space_id = ?',
        (space_id,),
    ):
        if team_id in seen or archived:
            continue
        seen.add(team_id)
        page_ids = json.loads(pages) if pages else []
        if not page_ids:
            # Top-level pages the app has seen, when the list itself was not kept.
            page_ids = [
                r[0]
                for r in db.execute(
                    "SELECT id FROM block WHERE parent_table = 'team' AND parent_id = ? AND alive = 1",
                    (team_id,),
                )
            ]
        users: set[str] = set()
        unresolved = []
        for m in json.loads(membership or '[]'):
            if m.get('user_id'):
                users.add(m['user_id'])
            elif m.get('group_id'):
                members = group_members.get(m['group_id'])
                if members:
                    users |= members
                else:
                    unresolved.append(group_names.get(m['group_id'], m['group_id']))
        teamspaces.append(
            {
                'id': team_id,
                'name': name,
                'icon': icon,
                'memberEmails': sorted({emails[u] for u in users if u in emails}),
                'pages': page_ids,
                'unresolvedGroups': unresolved,
            }
        )
        if not page_ids:
            missing.append(name)
    with open(out, 'w') as f:
        json.dump({'teamspaces': teamspaces, 'users': list(people.values())}, f, ensure_ascii=False, indent=2)
    for t in teamspaces:
        groups = f' ; groupes non résolus : {", ".join(t["unresolvedGroups"])}' if t['unresolvedGroups'] else ''
        print(f'{t["name"]} : {len(t["pages"])} page(s), {len(t["memberEmails"])} membre(s){groups}')
    print(f'{len(people)} personne(s) de Notion')
    if missing:
        print(f'Sans pages connues (ouvrez-les dans la barre latérale de Notion) : {", ".join(missing)}')
    shutil.rmtree(tmp)
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Seed the admin user. Safe to run multiple times (idempotent)."""
import sys
import os

# Add the api_py root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import get_db
from db.users import users_repo
from lib.password import hash_password
import config as cfg


def main():
    get_db()  # ensures DB file + schema

    username = cfg.SEED_ADMIN_USERNAME
    password = cfg.SEED_ADMIN_PASSWORD
    display_name = cfg.SEED_ADMIN_NAME

    existing = users_repo.find_by_username(username)
    if existing:
        print(f"[seed] User \"{username}\" already exists (id={existing['id']}). Nothing to do.")
        return

    pw_hash = hash_password(password)
    user = users_repo.create(
        username=username,
        display_name=display_name,
        password_hash=pw_hash,
        global_role="super_admin",
        status="active",
        must_change_password=True,
    )

    print("[seed] Created super admin:")
    print(f"       username: {user['username']}")
    print(f"       id:       {user['id']}")
    print("       NOTE: change this password on first login.")


if __name__ == "__main__":
    main()

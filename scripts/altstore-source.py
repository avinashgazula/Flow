#!/usr/bin/env python3
"""Builds and updates Marquee's AltStore source (source.json on the `altstore` branch).

Three steps, all standard library so they run on any runner with Python 3:

  info      read the built app's Info.plist (and entitlements, if the binary carries any) and the
            IPA's size into a small JSON file. The release workflow does this right after building.
  update    add that build to source.json: newest first, the same version and build replaced, only
            the newest few kept. Everything except the versions and news is regenerated from the
            constants below, so editing them here changes the source on the next release.
  validate  check a source against the fields AltStore's documentation requires.

AltStore compares `version` and `buildVersion` with the installed app and refuses an IPA whose
Info.plist says otherwise, so both always come from the built app, never from the tag.
"""

import argparse
import json
import os
import plistlib
import re
import sys
from datetime import datetime, timezone

REPO = "avinashgazula/Flow"
BRANCH = "altstore"
KEEP = 20
TINT = "#1a3dff"
IPA_NAME = "Flow-iOS.ipa"
# Entitlements AltStore doesn't want listed.
HIDDEN_ENTITLEMENTS = {"application-identifier", "com.apple.developer.team-identifier"}


def raw_url(repo, path):
    return f"https://raw.githubusercontent.com/{repo}/{BRANCH}/{path}"


def read_info(plist_path, ipa_path, entitlements_path=None):
    with open(plist_path, "rb") as f:
        plist = plistlib.load(f)
    privacy = {k: v for k, v in sorted(plist.items()) if k.startswith("NS") and k.endswith("UsageDescription")}
    entitlements = []
    if entitlements_path and os.path.exists(entitlements_path):
        try:
            with open(entitlements_path, "rb") as f:
                entitlements = sorted(k for k in plistlib.load(f) if k not in HIDDEN_ENTITLEMENTS)
        except Exception:
            # An unsigned binary has none, and codesign then prints nothing parseable.
            entitlements = []
    return {
        "bundleIdentifier": plist["CFBundleIdentifier"],
        "version": plist["CFBundleShortVersionString"],
        "buildVersion": str(plist["CFBundleVersion"]),
        "minOSVersion": plist.get("MinimumOSVersion", ""),
        "size": os.path.getsize(ipa_path),
        "entitlements": entitlements,
        "privacy": privacy,
    }


def release_title(tag):
    """v1.0.0-beta.15 becomes "Beta 15"; v1.2.0 becomes "Version 1.2.0"."""
    m = re.search(r"-([A-Za-z]+)\.?(\d+)$", tag)
    if m:
        return f"{m.group(1).capitalize()} {m.group(2)}"
    return f"Version {tag.lstrip('v')}"


def base_source(repo, info, now):
    bundle = info["bundleIdentifier"]
    return {
        "name": "Marquee",
        "identifier": f"{bundle}.source",
        "subtitle": "Beta builds of Marquee for iPhone and iPad",
        "description": (
            "Marquee is a front end for your own media. This source lists the iPhone and iPad app, "
            "and every new beta shows up in AltStore or SideStore as an update. AltStore installs "
            "iPhone and iPad apps only: the Apple TV and Mac builds are on the GitHub release page."
        ),
        "iconURL": raw_url(repo, "icon.png"),
        "website": f"https://github.com/{repo}",
        "tintColor": TINT,
        "apps": [],
        "news": [
            {
                "title": "Marquee is on AltStore",
                "identifier": "marquee-source-launch",
                "caption": "Add this source once, and each new Marquee beta appears as an update.",
                "date": now,
                "tintColor": TINT,
                "url": f"https://github.com/{repo}/releases",
                "appID": bundle,
            }
        ],
    }


def base_app(repo, info):
    return {
        "name": "Marquee",
        "bundleIdentifier": info["bundleIdentifier"],
        "developerName": "Marquee",
        "subtitle": "Your movies, shows and live TV",
        "localizedDescription": (
            "Marquee is a native front end for your own Jellyfin, Emby and Plex servers, WebDAV shares, "
            "IPTV providers and stream add-ons. It hosts no content: it plays from the sources you set up.\n\n"
            "Builds from this source are unsigned and carry no API keys. Marquee asks for your free TMDB key "
            "at first launch, or you can look around with Explore with Sample Data."
        ),
        "iconURL": raw_url(repo, "icon.png"),
        "tintColor": TINT,
        "category": "entertainment",
        "versions": [],
        "appPermissions": {"entitlements": [], "privacy": {}},
    }


def new_version(repo, tag, info, date):
    return {
        "version": info["version"],
        "buildVersion": info["buildVersion"],
        "date": date,
        "localizedDescription": f"{release_title(tag)}\nhttps://github.com/{repo}/releases/tag/{tag}",
        "downloadURL": f"https://github.com/{repo}/releases/download/{tag}/{IPA_NAME}",
        "size": info["size"],
        "minOSVersion": info["minOSVersion"],
    }


def load_existing(path):
    """The existing source, or None when the file is missing, empty or not a source we can build on."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def existing_versions(source, bundle):
    for app in source.get("apps", []) if source else []:
        if isinstance(app, dict) and app.get("bundleIdentifier") == bundle:
            return [v for v in app.get("versions", []) if isinstance(v, dict)]
    return []


def update_source(existing, info, tag, repo=REPO, date=None, keep=KEEP):
    now = date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    source = base_source(repo, info, now)
    app = base_app(repo, info)
    # The first release keeps the launch news; later ones keep whatever news is already there.
    if existing and isinstance(existing.get("news"), list):
        source["news"] = existing["news"]
    versions = existing_versions(existing, info["bundleIdentifier"])
    entry = new_version(repo, tag, info, now)
    versions = [v for v in versions if (v.get("version"), v.get("buildVersion")) != (entry["version"], entry["buildVersion"])]
    app["versions"] = ([entry] + versions)[:keep]
    app["appPermissions"] = {"entitlements": info["entitlements"], "privacy": info["privacy"]}
    source["apps"] = [app]
    return source


def validate(source):
    """Returns a list of problems against the documented AltStore source format."""
    problems = []
    if not source.get("name"):
        problems.append("source: name is missing")
    apps = source.get("apps")
    if not isinstance(apps, list) or not apps:
        return problems + ["source: apps must be a non-empty list"]
    seen = set()
    for app in apps:
        label = app.get("bundleIdentifier", "?")
        for key in ("name", "bundleIdentifier", "developerName", "localizedDescription", "iconURL"):
            if not isinstance(app.get(key), str) or not app[key]:
                problems.append(f"app {label}: {key} is missing")
        if label in seen:
            problems.append(f"app {label}: bundleIdentifier is not unique")
        seen.add(label)
        if app.get("category", "other") not in {"developer", "entertainment", "games", "lifestyle", "other", "photo-video", "social", "utilities"}:
            problems.append(f"app {label}: unknown category")
        for key in ("tintColor",):
            if key in app and not re.fullmatch(r"#?[0-9A-Fa-f]{6}", app[key]):
                problems.append(f"app {label}: {key} is not a hex colour")
        perms = app.get("appPermissions")
        if not isinstance(perms, dict) or not isinstance(perms.get("entitlements"), list) or not isinstance(perms.get("privacy"), dict):
            problems.append(f"app {label}: appPermissions needs entitlements (list) and privacy (object)")
        versions = app.get("versions")
        if not isinstance(versions, list) or not versions:
            problems.append(f"app {label}: versions must be a non-empty list")
            continue
        seen_versions = set()
        for v in versions:
            for key in ("version", "buildVersion", "date", "downloadURL"):
                if not isinstance(v.get(key), str) or not v[key]:
                    problems.append(f"app {label}: version {v.get('version', '?')} has no {key}")
            if not isinstance(v.get("size"), int) or isinstance(v.get("size"), bool) or v["size"] <= 0:
                problems.append(f"app {label}: version {v.get('version', '?')} needs a size in bytes")
            try:
                datetime.fromisoformat(str(v.get("date", "")).replace("Z", "+00:00"))
            except ValueError:
                problems.append(f"app {label}: version {v.get('version', '?')} date is not ISO 8601")
            key = (v.get("version"), v.get("buildVersion"))
            if key in seen_versions:
                problems.append(f"app {label}: version {key} is listed twice")
            seen_versions.add(key)
    ids = set()
    for item in source.get("news", []):
        for key in ("title", "identifier", "caption", "date"):
            if not isinstance(item.get(key), str) or not item[key]:
                problems.append(f"news: {key} is missing")
        if item.get("identifier") in ids:
            problems.append("news: identifier is not unique")
        ids.add(item.get("identifier"))
    return problems


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("info", help="read a built app's Info.plist and its IPA's size")
    i.add_argument("--plist", required=True)
    i.add_argument("--ipa", required=True)
    i.add_argument("--entitlements", help="entitlements plist from codesign, if the binary has any")
    i.add_argument("--out", required=True)
    u = sub.add_parser("update", help="add a build to source.json")
    u.add_argument("--source", required=True, help="source.json to update; created when missing or empty")
    u.add_argument("--info", required=True)
    u.add_argument("--tag", required=True)
    u.add_argument("--repo", default=REPO)
    u.add_argument("--date", help="ISO 8601 date of the release (default: now)")
    u.add_argument("--keep", type=int, default=KEEP)
    v = sub.add_parser("validate", help="check a source against AltStore's documented format")
    v.add_argument("source")
    args = p.parse_args(argv)

    if args.cmd == "info":
        write_json(args.out, read_info(args.plist, args.ipa, args.entitlements))
    elif args.cmd == "update":
        with open(args.info, encoding="utf-8") as f:
            info = json.load(f)
        source = update_source(load_existing(args.source), info, args.tag, args.repo, args.date, args.keep)
        problems = validate(source)
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        write_json(args.source, source)
    else:
        with open(args.source, encoding="utf-8") as f:
            problems = validate(json.load(f))
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

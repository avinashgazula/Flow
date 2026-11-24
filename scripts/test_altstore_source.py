#!/usr/bin/env python3
"""Tests for altstore-source.py. Run: python3 scripts/test_altstore_source.py"""

import importlib.util
import json
import os
import plistlib
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("altstore_source", os.path.join(HERE, "altstore-source.py"))
alt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alt)


def info(build="15", version="1.0.0", size=1000):
    return {
        "bundleIdentifier": "com.example.flow",
        "version": version,
        "buildVersion": build,
        "minOSVersion": "17.0",
        "size": size,
        "entitlements": [],
        "privacy": {"NSMicrophoneUsageDescription": "Listens for songs."},
    }


class AltStoreSourceTests(unittest.TestCase):
    def build(self, *builds):
        source = None
        for n in builds:
            source = alt.update_source(source, info(build=str(n)), f"v1.0.0-beta.{n - 1}", date=f"2026-11-{n:02d}T00:00:00Z")
        return source

    def versions(self, source):
        return source["apps"][0]["versions"]

    def test_creates_a_valid_source_from_nothing(self):
        source = alt.update_source(None, info(), "v1.0.0-beta.14", date="2026-11-23T07:18:06Z")
        self.assertEqual(alt.validate(source), [])
        v = self.versions(source)[0]
        self.assertEqual((v["version"], v["buildVersion"], v["size"], v["minOSVersion"]), ("1.0.0", "15", 1000, "17.0"))
        self.assertEqual(v["downloadURL"], "https://github.com/avinashgazula/Flow/releases/download/v1.0.0-beta.14/Flow-iOS.ipa")
        self.assertTrue(v["localizedDescription"].startswith("Beta 14\n"))
        self.assertEqual(source["apps"][0]["appPermissions"]["privacy"], info()["privacy"])
        self.assertEqual(len(source["news"]), 1)

    def test_new_version_goes_first(self):
        source = self.build(15, 16, 17)
        self.assertEqual([v["buildVersion"] for v in self.versions(source)], ["17", "16", "15"])
        self.assertEqual(alt.validate(source), [])

    def test_same_build_is_replaced_not_duplicated(self):
        source = self.build(15, 16)
        again = alt.update_source(source, info(build="15", size=2222), "v1.0.0-beta.14", date="2026-11-30T00:00:00Z")
        builds = [v["buildVersion"] for v in self.versions(again)]
        self.assertEqual(builds, ["15", "16"])
        self.assertEqual(self.versions(again)[0]["size"], 2222)
        self.assertEqual(alt.validate(again), [])

    def test_keeps_only_the_newest(self):
        source = None
        for n in range(1, 31):
            source = alt.update_source(source, info(build=str(n)), f"v1.0.0-beta.{n}", date="2026-11-01T00:00:00Z", keep=20)
        builds = [int(v["buildVersion"]) for v in self.versions(source)]
        self.assertEqual(builds, list(range(30, 10, -1)))

    def test_missing_empty_or_broken_file_starts_fresh(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(alt.load_existing(os.path.join(d, "none.json")))
            for name, text in (("empty.json", ""), ("broken.json", "{oops"), ("list.json", "[1]")):
                path = os.path.join(d, name)
                with open(path, "w") as f:
                    f.write(text)
                self.assertIsNone(alt.load_existing(path), name)

    def test_news_survives_updates(self):
        source = self.build(15)
        source["news"].append({"title": "Hello", "identifier": "hello", "caption": "Hi", "date": "2026-11-24"})
        again = alt.update_source(source, info(build="16"), "v1.0.0-beta.15", date="2026-11-25T00:00:00Z")
        self.assertEqual([n["identifier"] for n in again["news"]], ["marquee-source-launch", "hello"])

    def test_release_titles(self):
        self.assertEqual(alt.release_title("v1.0.0-beta.15"), "Beta 15")
        self.assertEqual(alt.release_title("v1.2.0-rc.2"), "Rc 2")
        self.assertEqual(alt.release_title("v1.2.0"), "Version 1.2.0")

    def test_validate_catches_problems(self):
        source = self.build(15)
        del source["apps"][0]["versions"][0]["size"]
        del source["apps"][0]["appPermissions"]["privacy"]
        source["apps"][0]["category"] = "movies"
        problems = alt.validate(source)
        self.assertEqual(len(problems), 3, problems)
        self.assertTrue(alt.validate({"name": "x", "apps": []}))

    def test_command_line_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            plist, ipa, out, src = (os.path.join(d, n) for n in ("Info.plist", "a.ipa", "info.json", "source.json"))
            with open(plist, "wb") as f:
                plistlib.dump({"CFBundleIdentifier": "com.example.flow", "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "15",
                               "MinimumOSVersion": "17.0", "NSLocalNetworkUsageDescription": "Finds servers.", "CFBundleName": "Flow"}, f, fmt=plistlib.FMT_BINARY)
            with open(ipa, "wb") as f:
                f.write(b"x" * 1234)
            self.assertEqual(alt.main(["info", "--plist", plist, "--ipa", ipa, "--entitlements", os.path.join(d, "none"), "--out", out]), 0)
            written = json.load(open(out))
            self.assertEqual((written["size"], written["buildVersion"], written["privacy"]), (1234, "15", {"NSLocalNetworkUsageDescription": "Finds servers."}))
            self.assertEqual(alt.main(["update", "--source", src, "--info", out, "--tag", "v1.0.0-beta.14"]), 0)
            self.assertEqual(alt.main(["validate", src]), 0)

    def test_entitlements_read_and_filtered(self):
        with tempfile.TemporaryDirectory() as d:
            plist, ipa, ents = (os.path.join(d, n) for n in ("Info.plist", "a.ipa", "e.plist"))
            with open(plist, "wb") as f:
                plistlib.dump({"CFBundleIdentifier": "b", "CFBundleShortVersionString": "1", "CFBundleVersion": 2}, f)
            open(ipa, "wb").write(b"x")
            with open(ents, "wb") as f:
                plistlib.dump({"application-identifier": "T.b", "com.apple.security.application-groups": ["g"]}, f)
            got = alt.read_info(plist, ipa, ents)
            self.assertEqual(got["entitlements"], ["com.apple.security.application-groups"])
            self.assertEqual(got["buildVersion"], "2")
            open(ents, "w").write("not a plist")
            self.assertEqual(alt.read_info(plist, ipa, ents)["entitlements"], [])


if __name__ == "__main__":
    unittest.main()

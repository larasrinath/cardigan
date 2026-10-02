/** Cases for the two guards the analyzer's files share: the Anaplan host pattern and the workspace or model ID pattern.
 * Every place that applies a guard is tested against these same lists, so loosening a pattern, or a place that stops
 * using it, fails a test. Synthetic hosts and IDs only. */

/** Hosts a cross-host read, a socket redirect and a socket close reason accept. */
export const ANAPLAN_HOSTS = ["eu2a.app.anaplan.com", "EU2A.APP.ANAPLAN.COM", "us-1a.app.anaplan.com", "x.anaplan.com"];

/** Hosts they refuse. */
export const OTHER_HOSTS = [
  // Another domain: unrelated, Anaplan's own without a label, Anaplan's as a prefix, or a lookalike.
  "example.net", "anaplan.com", ".anaplan.com", "eu2a.app.anaplan.com.example.net", "eu2a.app.anaplan.com.", "eu2a.app.anaplan.community",
  "evil-anaplan.com", "eu2a.appxanaplan.com", "eu2a.app.anaplanxcom",
  // A character that ends the host in a URL, so that the request would go to whatever stands before it.
  "eu2a.app.anaplan.com:8443", "eu2a.app.anaplan.com/a", "user@eu2a.app.anaplan.com", "a:b.anaplan.com", "example.net/.anaplan.com",
  "example.net?.anaplan.com", "example.net#.anaplan.com", "example.net\\.anaplan.com", "example.net%2f.anaplan.com", "[example.net].anaplan.com",
  // Characters no host name holds.
  "eu2a_b.app.anaplan.com", "eu2a app.anaplan.com", "éu2a.app.anaplan.com", "eu2a.app.anaplan.com\n",
  // An Anaplan host with something before or after it: the whole value is the host, and nothing is trimmed off it.
  "example.net/eu2a.app.anaplan.com", "example.net?eu2a.app.anaplan.com", "example.net#eu2a.app.anaplan.com", "example.net\\eu2a.app.anaplan.com",
  "https://eu2a.app.anaplan.com", "//eu2a.app.anaplan.com", "/eu2a.app.anaplan.com", "eu2a.app.anaplan.com/", "eu2a.app.anaplan.com:",
  "eu2a.app.anaplan.com?", "eu2a.app.anaplan.com?x", "eu2a.app.anaplan.com#", "eu2a.app.anaplan.com#x",
  " eu2a.app.anaplan.com", "\teu2a.app.anaplan.com", "\neu2a.app.anaplan.com", "\r\neu2a.app.anaplan.com", "eu2a.app.anaplan.com ", "eu2a.app.anaplan.com\t",
  "eu2a.app.anaplan.com\r", "eu2a.app.anaplan.com\r\n",
];

/** Workspace and model IDs: 32 letters or digits in either case, hexadecimal or not. */
export const SCOPE_IDS = ["0123456789abcdef0123456789abcdef", "FEDCBA9876543210FEDCBA9876543210", "GHIJKLMNOPQRSTUVWXYZghijklmnopqr", "stuvwxyz0123456789GHIJKLMNOPQRST"];

/** Not IDs: 32 characters of which one is not a letter or digit (among them every character that would change a REST
 * path or a socket destination), then the wrong lengths, then an ID with something after it or before it. The ID is
 * the whole value: one followed by a path, a query, a second destination part or a line break would otherwise be
 * written into the REST path and the socket destination as it stands. */
export const NOT_SCOPE_IDS = [
  ...["-", "_", "/", ".", "?", "#", "%", ":", " ", "@", "&", "=", "+", "\\", "é", "\n"].map(character => `0123456789abcdef${character}123456789abcdef`),
  "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0", "",
  ...["/", "/x", "?", "?x", "#", "#x", ":", ":x", ".", " ", "\t", "\n", "\r", "\r\n", "\n0123456789abcdef0123456789abcdef"]
    .map(tail => `0123456789abcdef0123456789abcdef${tail}`),
  ...["/", "x/", ":", "x:", ".", " ", "\t", "\n", "\r\n"].map(head => `${head}0123456789abcdef0123456789abcdef`),
];

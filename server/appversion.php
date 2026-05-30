<?php
/**
 * appversion.php — single endpoint for the uploader's "latest version".
 *
 *   GET   https://www.sonoclipshare.com/appversion.php
 *         → { "version": "2.6.2", "updated": "..." }   (public, CORS-enabled)
 *         Used by the Auth0 login page to decide whether to show the
 *         "new version available" banner — no GitHub rate limit involved.
 *
 *   POST  https://www.sonoclipshare.com/appversion.php?version=2.6.2
 *         header:  X-Release-Token: <secret>
 *         → updates the stored version.  Called by the GitHub Actions release
 *         workflow after publishing a release.
 *
 * Setup:
 *   - Put the shared secret in an env var SCS_RELEASE_TOKEN, OR in a file
 *     "scs_release_token" placed ONE LEVEL ABOVE the web root (chmod 600).
 *   - The same secret goes in the repo's GitHub secret SCS_RELEASE_TOKEN.
 */

header('Access-Control-Allow-Origin: *');

$store = __DIR__ . '/app-latest.json';

// ---- public read ----
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json');
    echo is_readable($store) ? file_get_contents($store) : '{"version":null}';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('method not allowed');
}

// ---- authenticated update ----
$expected = getenv('SCS_RELEASE_TOKEN');
if (!$expected) {
    $tokenFile = dirname(__DIR__) . '/scs_release_token';   // outside the web root
    if (is_readable($tokenFile)) {
        $expected = trim(file_get_contents($tokenFile));
    }
}
$provided = isset($_SERVER['HTTP_X_RELEASE_TOKEN']) ? $_SERVER['HTTP_X_RELEASE_TOKEN'] : '';
if (!$expected || !is_string($provided) || !hash_equals($expected, $provided)) {
    http_response_code(403);
    exit('forbidden');
}

// version is digits + dots only, e.g. "2.6.2"
$raw = isset($_GET['version']) ? $_GET['version'] : (isset($_POST['version']) ? $_POST['version'] : '');
$version = preg_replace('/[^0-9.]/', '', (string) $raw);
if (!preg_match('/^\d+(\.\d+){1,3}$/', $version)) {
    http_response_code(400);
    exit('bad version');
}

$payload = json_encode(['version' => $version, 'updated' => gmdate('c')]);
if (file_put_contents($store, $payload, LOCK_EX) === false) {
    http_response_code(500);
    exit('write failed');
}
echo 'ok ' . $version;

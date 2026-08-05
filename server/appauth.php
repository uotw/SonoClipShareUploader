<?php
/**
 * appauth.php — the sign-in bounce page for the desktop uploader.
 *
 * DEPLOY TO: /var/www/sonoclipshare.com/appauth.php
 * Tracked here as a reference copy; the live file is what runs.
 *
 * WHY THIS EXISTS
 *
 * The app signs in through the user's browser and wants the result back via its
 * sonoclipshare:// deeplink. Pointing Auth0 straight at that scheme works, but
 * costs an "Authorize App" screen on EVERY sign-in:
 *
 *   "Even when consent is skipped for first-party applications, a login
 *    confirmation prompt may still appear when the application uses a
 *    non-verifiable callback URI (such as localhost or a custom URI scheme)."
 *          -- Auth0, user-consent-and-third-party-applications
 *
 * A custom scheme cannot be verified as belonging to anyone, so Auth0 asks the
 * user to vouch for it. Loopback (http://127.0.0.1) is in the same category, so
 * switching to it would not help either. An HTTPS callback on a domain Auth0 can
 * verify is the only form that skips the prompt -- hence this page: Auth0
 * redirects HERE, and this hands off to the deeplink.
 *
 * IS PASSING THE CODE THROUGH A WEB PAGE SAFE?
 *
 * Yes, because of PKCE. The authorization code is useless without the
 * code_verifier, which never leaves the app -- only its SHA-256 hash was ever
 * sent to Auth0. The code is also single-use and short-lived. This page neither
 * stores nor logs it.
 *
 * It also replaces what the user used to see at the end of sign-in: Auth0's
 * redirect stub, whose entire body is the word "OK".
 */

header('Content-Type: text/html; charset=utf-8');
// A credential is in this URL. Keep it out of caches and out of the referrer
// sent to the next page.
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Referrer-Policy: no-referrer');

/**
 * Auth0's code/state are URL-safe base64. Anything else is not from Auth0, and
 * must not reach the page -- this value is interpolated into a URL and into
 * HTML, so it is validated at the door rather than escaped in three places
 * later.
 */
function scs_safe_param($name)
{
    $v = isset($_GET[$name]) ? (string)$_GET[$name] : '';
    return preg_match('/^[A-Za-z0-9._~-]{1,512}$/', $v) ? $v : '';
}

$code  = scs_safe_param('code');
$state = scs_safe_param('state');

// Auth0 reports failures here too (access_denied, etc). Pass them on so the app
// can stop waiting, rather than leaving it on a spinner forever.
$error = scs_safe_param('error');

$deeplink = '';
if ($code !== '') {
    $deeplink = 'sonoclipshare://callback?code=' . rawurlencode($code)
              . ($state !== '' ? '&state=' . rawurlencode($state) : '');
} elseif ($error !== '') {
    $deeplink = 'sonoclipshare://callback?error=' . rawurlencode($error);
}

$deeplinkAttr = htmlspecialchars($deeplink, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Signing in to SonoClipShare Uploader</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #282828; color: #f4f4f4;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    text-align: center; padding: 24px;
  }
  .card { max-width: 460px; }
  h1 { font-size: 1.4rem; font-weight: 700; margin: 0 0 12px; }
  p  { margin: 0 0 10px; color: #cfcfcf; line-height: 1.5; }
  a  { color: #5ac8fa; }
  .hint { font-size: .85rem; color: #9a9a9a; }
</style>
</head>
<body>
  <div class="card">
<?php if ($deeplink === ''): ?>
    <h1>Something went wrong</h1>
    <p>This page was opened without a valid sign-in result.</p>
    <p class="hint">Return to SonoClipShare Uploader and try signing in again.</p>
<?php elseif ($error !== ''): ?>
    <h1>Sign-in was cancelled</h1>
    <p>Returning you to SonoClipShare Uploader&hellip;</p>
    <p class="hint">You can close this tab.</p>
<?php else: ?>
    <h1>You're signed in</h1>
    <p>Returning you to SonoClipShare Uploader&hellip;</p>
    <p class="hint">You can close this tab. If nothing happens,
       <a id="manual" href="<?= $deeplinkAttr ?>">click here to reopen the app</a>.</p>
<?php endif; ?>
  </div>

<?php if ($deeplink !== ''): ?>
<script>
  // Assigning location rather than using a meta refresh: a custom scheme in a
  // meta refresh is ignored by some browsers, and this way the manual link
  // above stays as the fallback if the OS has no handler registered (i.e. the
  // app is not installed).
  window.location.href = <?= json_encode($deeplink, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
</script>
<?php endif; ?>
</body>
</html>

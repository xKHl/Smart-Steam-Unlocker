/**
 * Isolated Steam Community session used only to read the owner's badges page.
 *
 * Sign-in happens on Steam's own login page inside a separate, persistent
 * partition. The app never sees the password; it only checks for Steam's
 * steamLoginSecure cookie and sends that partition's cookies to
 * steamcommunity.com when reading badges.
 */

const { BrowserWindow, session, shell } = require('electron');
const { steamIdFromLoginCookie, isAllowedSignInUrl: isAllowedUrl } = require('./communityBadges');

const PARTITION = 'persist:steam-community';
const COMMUNITY_URL = 'https://steamcommunity.com';
const LOGIN_URL = `${COMMUNITY_URL}/login/home/?goto=`;
const LOGIN_COOKIE = 'steamLoginSecure';

let loginWindow = null;

function communitySession() {
  return session.fromPartition(PARTITION);
}

async function getStatus() {
  try {
    const cookies = await communitySession().cookies.get({ url: COMMUNITY_URL, name: LOGIN_COOKIE });
    const steamId = cookies.length ? steamIdFromLoginCookie(cookies[0].value) : null;
    return { signedIn: Boolean(steamId), steamId };
  } catch {
    return { signedIn: false, steamId: null };
  }
}

/** Opens Steam's login page and resolves once sign-in completes or the window closes. */
function signIn(parent) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return new Promise((resolve) => loginWindow.once('closed', () => resolve(getStatus())));
  }

  return new Promise((resolve) => {
    const ses = communitySession();
    loginWindow = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: false,
      autoHideMenuBar: true,
      backgroundColor: '#171a21',
      title: 'Steam Community',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async () => {
      ses.cookies.removeListener('changed', onCookieChanged);
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
    };

    const onCookieChanged = (_event, cookie, _cause, removed) => {
      if (!removed && cookie.name === LOGIN_COOKIE && steamIdFromLoginCookie(cookie.value)) finish();
    };
    ses.cookies.on('changed', onCookieChanged);

    // Keep the window on Steam's own sign-in pages; anything else opens in the
    // user's browser instead of inside the signed-in partition.
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedUrl(url)) {
        event.preventDefault();
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
      }
    });

    loginWindow.once('closed', () => {
      ses.cookies.removeListener('changed', onCookieChanged);
      loginWindow = null;
      resolve(getStatus());
    });

    loginWindow.loadURL(LOGIN_URL);
  });
}

async function signOut() {
  await communitySession().clearStorageData();
  return getStatus();
}

function fetchWithSession(url) {
  return communitySession().fetch(url, { headers: { Accept: 'text/html' } });
}

module.exports = {
  PARTITION,
  getStatus,
  signIn,
  signOut,
  fetchWithSession,
};

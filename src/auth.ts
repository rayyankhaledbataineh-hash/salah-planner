import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as readline from 'readline';
import { CREDENTIALS_PATH, TOKEN_PATH } from './config';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Cloud auth path. Builds an OAuth2 client entirely from environment variables
 * (injected from Secret Manager at deploy time) — no filesystem reads/writes and
 * no interactive browser flow, both of which are impossible in a serverless,
 * read-only-filesystem environment.
 *
 * The long-lived refresh token is enough: the Google client library transparently
 * exchanges it for a fresh access token on the first API call of each invocation.
 */
export function authorizeFromEnv(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Cloud auth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.'
    );
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

export async function authorize(): Promise<OAuth2Client> {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Auto-save any token refreshes so subsequent runs start with a valid token.
  oAuth2Client.on('tokens', (tokens) => {
    const existing = fs.existsSync(TOKEN_PATH)
      ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'))
      : {};
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...existing, ...tokens }));
  });

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);

    // Proactively refresh if the access token is expired or about to expire
    // (within 5 minutes). This avoids relying on the first API call to trigger
    // a refresh, and ensures the refreshed token is persisted above.
    const expiryDate = token.expiry_date as number | undefined;
    const fiveMinutes = 5 * 60 * 1000;
    if (expiryDate && expiryDate - Date.now() < fiveMinutes) {
      const { credentials: refreshed } = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(refreshed);
      // The 'tokens' event fires automatically and persists the result.
    }

    return oAuth2Client;
  }

  return getNewToken(oAuth2Client);
}

async function getNewToken(oAuth2Client: OAuth2Client): Promise<OAuth2Client> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  const open = (await import('open')).default;
  await open(authUrl);
  console.log('Browser opened — sign in and authorize the app.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Wait for the user to paste the redirect URL. Keeping the await OUTSIDE the
  // Promise executor means a thrown error here propagates normally instead of
  // being swallowed.
  const redirectUrl = await new Promise<string>((resolve) => {
    rl.question('\nPaste the full redirect URL from your browser here: ', resolve);
  });
  rl.close();

  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) {
    throw new Error('No "code" parameter found in the pasted URL.');
  }

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('Token saved! You are authorized.');
  return oAuth2Client;
}
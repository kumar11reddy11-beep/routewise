'use strict';

const fs = require('fs');
const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Gmail Service
 *
 * Fetches unread emails labeled 'RouteWise', parses their content,
 * and provides helpers to mark emails as read and fetch attachments.
 *
 * OAuth credentials and tokens are loaded from paths set in config (never hardcoded).
 */

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

/**
 * Build an authenticated Gmail API client from stored OAuth credentials.
 * @returns {google.auth.OAuth2} Authenticated OAuth2 client
 */
async function getAuthClient() {
  const { credentialsPath, tokenPath } = config.gmail;

  if (!credentialsPath || !fs.existsSync(credentialsPath)) {
    throw new Error(`Gmail credentials not found at: ${credentialsPath}`);
  }
  if (!tokenPath || !fs.existsSync(tokenPath)) {
    throw new Error(`Gmail token not found at: ${tokenPath}`);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

  // Support both "installed" and "web" credential shapes
  const { client_secret, client_id, redirect_uris } =
    credentials.installed || credentials.web || credentials;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

/**
 * Decode a Gmail message part body (base64url encoded).
 * @param {string} data - base64url-encoded string
 * @returns {string} Decoded UTF-8 text
 */
function decodeBase64(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/**
 * Recursively extract plain-text body from MIME message parts.
 * @param {object[]} parts - Gmail message parts array
 * @returns {string} Plain text content
 */
function extractBody(parts) {
  if (!parts || !parts.length) return '';

  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64(part.body.data);
    }
    if (part.parts) {
      const nested = extractBody(part.parts);
      if (nested) return nested;
    }
  }

  // Fallback: try text/html parts if no plain text found
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      // Strip basic HTML tags for plain text
      return decodeBase64(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (part.parts) {
      const nested = extractBody(part.parts);
      if (nested) return nested;
    }
  }
  return '';
}

/**
 * Extract attachment metadata from message parts.
 * @param {object[]} parts - Gmail message parts
 * @returns {object[]} Array of attachment descriptors
 */
function extractAttachments(parts) {
  if (!parts) return [];
  const attachments = [];
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size,
      });
    }
    if (part.parts) {
      attachments.push(...extractAttachments(part.parts));
    }
  }
  return attachments;
}

/**
 * Get a header value from a Gmail message headers array.
 * @param {object[]} headers
 * @param {string} name
 * @returns {string}
 */
function getHeader(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

/**
 * Fetch all unread emails with the 'RouteWise' label.
 * @returns {Promise<object[]>} Array of { id, subject, from, date, body, attachments }
 */
async function fetchRouteWiseEmails() {
  const auth = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Query: label:RouteWise AND is:unread
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'label:RouteWise is:unread',
  });

  const messageIds = listRes.data.messages || [];
  logger.info(`Found ${messageIds.length} unread RouteWise email(s).`);

  if (!messageIds.length) return [];

  const emails = [];
  for (const { id } of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });

      const msg = msgRes.data;
      const headers = msg.payload?.headers || [];
      const parts = msg.payload?.parts || [];

      // Extract body — check payload body directly if no parts (single-part message)
      const body = parts.length
        ? extractBody(parts)
        : decodeBase64(msg.payload?.body?.data || '');

      emails.push({
        id,
        subject: getHeader(headers, 'Subject'),
        from: getHeader(headers, 'From'),
        date: getHeader(headers, 'Date'),
        body,
        attachments: extractAttachments(parts),
      });
    } catch (err) {
      logger.error(`Failed to fetch message ${id}:`, err.message);
    }
  }

  return emails;
}

/**
 * Remove the UNREAD label from a message, marking it as read.
 * @param {string} messageId - Gmail message ID
 */
async function markAsRead(messageId) {
  const auth = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
  logger.debug(`Marked message ${messageId} as read.`);
}

/**
 * Fetch and decode an email attachment by attachment ID.
 * @param {string} messageId - Gmail message ID
 * @param {string} attachmentId - Attachment ID from the message
 * @returns {Promise<Buffer>} Raw attachment data as a Buffer
 */
async function getAttachment(messageId, attachmentId) {
  const auth = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = res.data.data || '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

module.exports = { fetchRouteWiseEmails, markAsRead, getAttachment };

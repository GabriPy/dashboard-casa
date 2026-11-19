import { sendNotification, setVapidDetails } from 'web-push';
import { config, pushConfigured } from './config.js';

if (pushConfigured()) {
  setVapidDetails(config.push.vapidSubject, config.push.vapidPublicKey, config.push.vapidPrivateKey);
}

export { pushConfigured };

export function sendPushNotification(subscription, payload) {
  if (!pushConfigured()) throw new Error('Notifiche push non configurate sul server.');
  return sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    { TTL: 60 * 60 },
  );
}

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = String(process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const uid = String(process.env.CIA_ADMIN_UID || '').trim();
const role = String(process.env.CIA_ADMIN_ROLE || 'owner').trim();
const active = String(process.env.CIA_ADMIN_ACTIVE || 'true').toLowerCase() !== 'false';

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) throw new Error('Invalid CIA_RESTAURANT_ID');
if (!uid || uid.length > 128) throw new Error('CIA_ADMIN_UID is required and must be <= 128 chars');
if (!['owner', 'reviewer'].includes(role)) throw new Error('CIA_ADMIN_ROLE must be owner or reviewer');

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const ref = restaurantRef.collection('admins').doc(uid);
  const existing = await ref.get();
  await ref.set({
    active,
    role,
    uid,
    createdAt: existing.exists ? existing.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    provisionedBy: 'trusted_github_action'
  }, { merge: true });

  const masked = uid.length <= 8 ? '***' : `${uid.slice(0, 3)}…${uid.slice(-4)}`;
  console.log(`[Admin grant] Restaurant: ${restaurantId}`);
  console.log(`[Admin grant] UID: ${masked}`);
  console.log(`[Admin grant] Role: ${role}`);
  console.log(`[Admin grant] Active: ${active}`);
}

main().catch((error) => {
  console.error(`[Admin grant] FAILED: ${error?.message || error}`);
  process.exit(1);
});

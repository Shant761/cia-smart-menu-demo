# Firebase Spark stage

Current deployment stage: Firebase Spark plan.

- Firebase Hosting: enabled for the existing static Smart Menu frontend.
- Firestore: created in production mode; browser access remains blocked by security rules.
- Cloud Functions: source code is kept in `functions/`, but `/api/**` is not routed to Functions until the project moves to Blaze.
- Storage: remains locked until the image upload flow is implemented.

When Blaze is enabled, restore the Hosting rewrite from `/api/**` to the `api` Cloud Function in `europe-west1` and deploy Functions.

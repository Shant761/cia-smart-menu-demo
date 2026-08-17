const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const express = require('express');

admin.initializeApp();

setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const healthHandler = (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'cia-smart-menu-api',
    version: 1,
    timestamp: new Date().toISOString()
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.use((_req, res) => {
  res.status(404).json({
    error: 'not_found'
  });
});

exports.api = onRequest(app);

'use strict';

const assert = require('node:assert/strict');
const conversation = require('./conversation');

const rawMessages = [
  {
    id: 'm3',
    timestamp: 1788386400,
    fromMe: false,
    body: 'Hola, gracias. Lo reviso mañana.',
    hasMedia: false
  },
  {
    id: 'm1',
    timestamp: 1788296400,
    fromMe: true,
    body: 'Te compartimos tu cotización COT-32.',
    hasMedia: true,
    media: { mimetype: 'application/pdf', filename: 'Cotizacion_COT-32.pdf' },
    ackName: 'READ'
  },
  {
    id: 'm2',
    timestamp: 1788296460,
    key: { id: 'm2-key', fromMe: true },
    body: 'Quedamos atentos a cualquier duda.',
    hasMedia: false
  }
];

const messages = conversation.normalizeMessages(rawMessages, { limit: 20 });
assert.equal(messages.length, 3);
assert.deepEqual(messages.map(item => item.id), ['m1', 'm2', 'm3']);
assert.equal(messages[0].direction, 'OUTGOING');
assert.equal(messages[1].direction, 'OUTGOING');
assert.equal(messages[2].direction, 'INCOMING');
assert.equal(messages[0].media, '[Archivo: Cotizacion_COT-32.pdf]');
assert.ok(!JSON.stringify(messages).includes('@c.us'));

const activities = conversation.normalizeActivity([
  {
    at: '2026-09-01T15:00:00.000Z',
    kind: 'document',
    state: 'SENT',
    documentType: 'cotizacion',
    reference: 'COT-32',
    phone: '+57 300 111 2233',
    filename: 'Cotizacion_COT-32.pdf',
    source: 'cotizacion',
    messageId: 'msg-quote-32'
  },
  {
    at: '2026-09-01T15:10:00.000Z',
    kind: 'document',
    state: 'SENT',
    documentType: 'pedido',
    reference: 'OP-8',
    phone: '+57 300 111 2233',
    filename: 'Orden_OP-8.pdf'
  },
  {
    at: '2026-09-01T15:20:00.000Z',
    kind: 'document',
    state: 'SENT',
    documentType: 'cotizacion',
    reference: 'COT-99',
    phone: '+57 311 999 0000',
    filename: 'Otra.pdf'
  }
], {
  phone: '3001112233',
  reference: 'COT #32'
});

assert.equal(activities.length, 2);
assert.equal(activities[0].referenceMatch, true);
assert.equal(activities[1].referenceMatch, false);

const evidenceWithReply = conversation.buildConversationEvidence(messages, activities);
assert.equal(evidenceWithReply.messageCount, 3);
assert.equal(evidenceWithReply.incomingCount, 1);
assert.equal(evidenceWithReply.outgoingCount, 2);
assert.equal(evidenceWithReply.quoteDelivery.reference, 'COT-32');
assert.equal(evidenceWithReply.customerRepliedAfterQuote, true);
assert.equal(evidenceWithReply.customerRepliedAfterLastOutgoing, true);

const silentMessages = conversation.normalizeMessages(rawMessages.slice(1), { limit: 20 });
const silentEvidence = conversation.buildConversationEvidence(silentMessages, activities);
assert.equal(silentEvidence.incomingCount, 0);
assert.equal(silentEvidence.outgoingCount, 2);
assert.equal(silentEvidence.customerRepliedAfterQuote, false);
assert.equal(silentEvidence.customerRepliedAfterLastOutgoing, false);
assert.equal(silentEvidence.quoteDelivery.state, 'SENT');

const filtered = conversation.normalizeMessages(rawMessages, {
  since: '2026-09-03T00:00:00.000Z',
  limit: 20
});
assert.ok(filtered.every(item => Date.parse(item.at) >= Date.parse('2026-09-03T00:00:00.000Z')));

console.log('WhatsApp conversation context tests: PASS');

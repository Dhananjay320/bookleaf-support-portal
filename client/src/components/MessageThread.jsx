import { formatDateTime } from '../utils/format.js';

/**
 * The author-visible conversation: original query first, then replies in order.
 * `viewer` decides which side is "you".
 */
export function MessageThread({ ticket, viewer }) {
  const entries = [
    { id: 'original', senderRole: 'author', senderName: ticket.author.name, body: ticket.description, createdAt: ticket.createdAt, original: true },
    ...ticket.messages,
  ];

  return (
    <ol className="thread">
      {entries.map((m) => {
        const mine = m.senderRole === viewer;
        const who = m.senderRole === 'admin' ? (viewer === 'author' ? 'BookLeaf Support' : m.senderName) : m.senderName;
        return (
          <li key={m.id} className={`msg ${m.senderRole} ${mine ? 'mine' : ''}`}>
            <div className="msg-meta">
              <strong>{mine ? 'You' : who}</strong>
              {m.original && <span className="muted"> · original query</span>}
              {m.aiAssisted && viewer === 'admin' && <span className="tag small">AI-assisted</span>}
              <span className="muted"> · {formatDateTime(m.createdAt)}</span>
            </div>
            <div className="msg-body">{m.body}</div>
          </li>
        );
      })}
    </ol>
  );
}

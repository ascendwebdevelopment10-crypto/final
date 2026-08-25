(function repairStoredOperatorChats() {
  try {
    const chats = JSON.parse(localStorage.getItem('nitro-chats') || '[]');
    if (!Array.isArray(chats)) { localStorage.removeItem('nitro-chats'); return; }
    const invalid = /^(?:undefined|null|nan|\[object Object\])$/i;
    const clean = value => {
      const text = String(value ?? '').trim();
      return invalid.test(text) ? '' : text;
    };
    const repaired = chats
      .filter(chat => chat && typeof chat === 'object')
      .map(chat => ({
        ...chat,
        title: clean(chat.title) || 'New chat',
        messages: (Array.isArray(chat.messages) ? chat.messages : [])
          .filter(message => message && typeof message === 'object')
          .map(message => ({ ...message, text: clean(message.text), agent: clean(message.agent) }))
          .filter(message => message.text),
      }));
    localStorage.setItem('nitro-chats', JSON.stringify(repaired.slice(0, 50)));
  } catch {
    localStorage.removeItem('nitro-chats');
  }
})();

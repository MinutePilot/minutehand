// MinuteHand workspace: small helpers shared by the screens.
// Text is always written with textContent, never as HTML.

const UI = (() => {
  // A button that is safe to build from database text.
  function button(label, aria, onClick, { primary = false, disabled = false, small = true } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (primary ? 'btn-primary' : 'btn-ghost') + (small ? ' btn-small' : '');
    b.textContent = label;
    if (aria) b.setAttribute('aria-label', aria);
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  // Shows a message in a status box, with an optional Try again button. Empty text hides it.
  function setStatus(box, text, retry) {
    box.replaceChildren();
    if (!text) { box.classList.add('hidden'); return; }
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (retry) box.appendChild(button('Try again', null, retry, { small: false }));
    box.classList.remove('hidden');
  }

  // A plain sentence for a failed save. Never shows the technical message.
  function saveFailure(error, what = 'that') {
    if (error && (error.code === '42501' || error.status === 403)) {
      return 'You do not have permission to do that. Ask an admin.';
    }
    return `We could not save ${what}. Check that you are online and try again.`;
  }

  return { button, setStatus, saveFailure };
})();

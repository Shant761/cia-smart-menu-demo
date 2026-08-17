// Move Online Waiter entry to the top of the page so it never covers menu controls.
(function placeOnlineWaiterAtTop() {
  const button = document.querySelector('#onlineWaiterBtn');
  const topbar = document.querySelector('.topbar');
  if (!button || !topbar) return;

  topbar.insertAdjacentElement('afterend', button);
  button.classList.add('online-waiter-top');

  const style = document.createElement('style');
  style.id = 'onlineWaiterTopStyles';
  style.textContent = `
    .online-waiter-btn.online-waiter-top {
      position: static;
      right: auto;
      bottom: auto;
      width: 100%;
      margin-top: 12px;
      padding: 12px 15px;
      justify-content: center;
      box-shadow: 0 10px 24px rgba(24,64,42,.14);
    }
    .online-waiter-btn.online-waiter-top .waiter-count {
      margin-left: 2px;
    }
  `;
  document.head.appendChild(style);
})();

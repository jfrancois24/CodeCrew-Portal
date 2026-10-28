// Ask before destructive actions: any form with data-confirm="..." shows a confirmation dialog.
document.addEventListener('submit', (event) => {
  const message = event.target.dataset && event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

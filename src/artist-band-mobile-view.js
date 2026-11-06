export function setupArtistBandMobileView(workspace, controls) {
  const buttons = controls.querySelectorAll('button[data-view]')
  const preview = workspace.querySelector('#ab-preview')

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (workspace.dataset.view === button.dataset.view) return

      workspace.dataset.view = button.dataset.view
      for (const option of buttons) {
        option.setAttribute('aria-pressed', String(option === button))
      }
      if (button.dataset.view === 'preview') {
        const html = preview.getAttribute('srcdoc')
        if (html !== null) {
          // Lay out the newly visible iframe before reloading its document.
          preview.getBoundingClientRect()
          preview.srcdoc = html
        }
      }
      workspace.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
  }
}

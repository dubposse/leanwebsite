export function setupBusinessMobileView(workspace, controls, showPreview) {
  const buttons = controls.querySelectorAll('button[data-view]')

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (workspace.dataset.view === button.dataset.view) return

      workspace.dataset.view = button.dataset.view
      for (const option of buttons) {
        option.setAttribute('aria-pressed', String(option === button))
      }
      if (button.dataset.view === 'preview') showPreview()
      workspace.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
  }
}

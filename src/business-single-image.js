export function wireBusinessSingleImage({ box, input, status, isEditorDisabled, onFile }) {
  async function handleFile(file) {
    if (!file || input.disabled) return

    input.dataset.imageProcessing = 'true'
    input.disabled = true
    status.dataset.state = 'pending'
    status.textContent = 'Bild wird verarbeitet …'
    try {
      await onFile(file)
      status.textContent = ''
      status.dataset.state = ''
    } catch (error) {
      status.textContent = error instanceof Error && error.message
        ? error.message
        : 'Bild konnte nicht verarbeitet werden. Bitte versuche es erneut.'
      status.dataset.state = 'error'
    } finally {
      input.value = ''
      delete input.dataset.imageProcessing
      input.disabled = isEditorDisabled()
    }
  }

  input.addEventListener('change', () => {
    handleFile(input.files[0])
  })
  for (const eventName of ['dragenter', 'dragover']) {
    box.addEventListener(eventName, (event) => {
      event.preventDefault()
      if (!input.disabled) box.classList.add('over')
    })
  }
  for (const eventName of ['dragleave', 'drop']) {
    box.addEventListener(eventName, (event) => {
      event.preventDefault()
      box.classList.remove('over')
    })
  }
  box.addEventListener('drop', (event) => {
    handleFile(event.dataTransfer.files[0])
  })
}

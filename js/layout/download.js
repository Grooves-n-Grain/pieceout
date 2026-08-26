/** Trigger a browser download of a text file. */
export function downloadText(filename, text, mime = 'image/svg+xml') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay the revoke: some browsers still need the URL after click() returns
    // to actually start the download, especially for multiple rapid downloads.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

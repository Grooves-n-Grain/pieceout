/** Decode a local preview, using the service for HEIC or unsupported browser codecs. */
import { previewImage } from './api.js';

export async function loadImagePreview(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image at most 20 MB.');
    let url = '';
    const decode = async blob => {
        url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    };
    try {
        let image;
        if (/\.(heic|heif|heics|heifs|hif)$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) {
            image = await decode(await previewImage(file));
        } else {
            try { image = await decode(file); }
            catch {
                URL.revokeObjectURL(url); url = '';
                image = await decode(await previewImage(file));
            }
        }
        const width = image.naturalWidth, height = image.naturalHeight;
        if (width * height > 16000000 || Math.min(width, height) < 2) {
            throw new Error('Choose an image between 2 × 2 and 16 million pixels.');
        }
        return { url, width, height };
    } catch (error) {
        if (url) URL.revokeObjectURL(url);
        throw error;
    }
}

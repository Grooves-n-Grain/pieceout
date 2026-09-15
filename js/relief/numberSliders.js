/** Add range controls while keeping number inputs authoritative for saved settings. */
export function initNumberSliders(form) {
    const pairs = [...form.querySelectorAll('input[type="number"]')].map(input => {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = `${input.id}-slider`;
        slider.min = input.min;
        slider.max = input.dataset.sliderMax || input.max;
        slider.step = input.dataset.sliderStep || '0.1';
        const row = input.closest('.param-row');
        slider.setAttribute('aria-label', `${input.labels[0].textContent} (${row.querySelector('.unit').textContent})`);
        row.classList.add('relief-number-slider');
        row.append(slider);
        slider.addEventListener('input', () => { input.value = slider.value; });
        return [input, slider];
    });

    return function updateNumberSliders() {
        pairs.forEach(([input, slider]) => {
            slider.disabled = input.disabled;
            // Keep partial/invalid typed values available for normal form validation.
            if (!input.validity.valid) return;
            // Retain an expanded range while dragging so its scale stays stable.
            slider.max = Math.max(Number(slider.max), input.valueAsNumber);
            slider.value = input.value;
            slider.setAttribute('aria-valuetext', `${input.value} ${input.closest('.param-row').querySelector('.unit').textContent}`);
        });
    };
}

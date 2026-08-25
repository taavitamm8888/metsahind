// Inquiry form behaviour (filename display, drag-drop, submit state)
document.addEventListener('alpine:init', () => {
    Alpine.data('inquiryForm', () => ({
        sent: false,
        fileName: '',
        dragging: false,
        pickName(e) {
            this.fileName = e.target.files.length ? e.target.files[0].name : '';
        },
        handleDrop(e) {
            const files = e.dataTransfer.files;
            if (files.length) {
                this.$refs.file.files = files;
                this.fileName = files[0].name;
            }
            this.dragging = false;
        },
        submit() {
            // NB: päring kuvatakse kinnitatuna kliendipoolselt.
            // Tegeliku saatmise jaoks ühenda vorm serveripoolse käsitlejaga (nt send.php / e-post).
            this.sent = true;
        }
    }));
});

document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer for scroll animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Optional: unobserve after animating in for one-time reveal
                // observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const revealElements = document.querySelectorAll('.reveal-on-scroll, .reveal-slide-right');
    revealElements.forEach(el => observer.observe(el));
});

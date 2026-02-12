/* ═══════════════════════════════════════════════════════════
   CloudCodeX Landing Page — script.js
   Three.js (r128) + GSAP 3.12 + ScrollTrigger
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Palette ────────────────────────────────────────────
    const C = {
        void: 0x000000,
        jet: 0x151a1f,
        ebony: 0x272c2e,
        coal: 0x394142,
        midnight: 0x535d5e,
        white: 0xffffff,
    };

    // ═══════════ NAVBAR ═══════════
    const navbar = document.getElementById('navbar');
    const mobileToggle = document.getElementById('mobileToggle');
    const navLinks = document.getElementById('navLinks');

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 60);
    });

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
        });
    }

    // Close mobile menu on link click
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => navLinks.classList.remove('open'));
    });

    // ═══════════ THREE.JS — HERO SCENE ═══════════
    function initHeroScene() {
        const canvas = document.getElementById('heroCanvas');
        if (!canvas) return;

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(C.void, 0.035);

        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        camera.position.set(0, 0, 5);

        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(C.void, 0);

        function resize() {
            const w = canvas.parentElement.clientWidth;
            const h = canvas.parentElement.clientHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        resize();
        window.addEventListener('resize', resize);

        // Lights
        const ambient = new THREE.AmbientLight(C.white, 0.3);
        scene.add(ambient);

        const dir = new THREE.DirectionalLight(C.white, 0.8);
        dir.position.set(5, 5, 5);
        scene.add(dir);

        const point1 = new THREE.PointLight(C.midnight, 1.5, 15);
        point1.position.set(-3, 2, 3);
        scene.add(point1);

        const point2 = new THREE.PointLight(C.coal, 1, 12);
        point2.position.set(3, -2, 2);
        scene.add(point2);

        // Main model — Icosahedron with wireframe overlay
        const mainGeo = new THREE.IcosahedronGeometry(1.4, 1);
        const mainMat = new THREE.MeshStandardMaterial({
            color: C.ebony,
            metalness: 0.6,
            roughness: 0.35,
            flatShading: true,
        });
        const mainMesh = new THREE.Mesh(mainGeo, mainMat);
        scene.add(mainMesh);

        const wireGeo = new THREE.IcosahedronGeometry(1.42, 1);
        const wireMat = new THREE.MeshBasicMaterial({
            color: C.coal,
            wireframe: true,
            transparent: true,
            opacity: 0.3,
        });
        const wireMesh = new THREE.Mesh(wireGeo, wireMat);
        scene.add(wireMesh);

        // Edge highlight on hover
        const edgesGeo = new THREE.EdgesGeometry(mainGeo);
        const edgesMat = new THREE.LineBasicMaterial({ color: C.midnight, transparent: true, opacity: 0 });
        const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
        scene.add(edgesLine);

        // Floating particles
        const particleCount = 400;
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 10;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
        }
        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: C.midnight,
            size: 0.025,
            transparent: true,
            opacity: 0.6,
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        // Mouse parallax
        let mouseX = 0, mouseY = 0;
        let targetRotX = 0, targetRotY = 0;
        let isDragging = false, prevDragX = 0, prevDragY = 0;
        let dragVelX = 0, dragVelY = 0;
        let accDragX = 0, accDragY = 0;

        const heroSection = document.getElementById('hero');
        heroSection.addEventListener('mousemove', (e) => {
            const rect = heroSection.getBoundingClientRect();
            mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
            mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        });

        // Hover edge highlight
        canvas.addEventListener('mouseenter', () => {
            gsap.to(edgesMat, { opacity: 0.5, duration: 0.4 });
        });
        canvas.addEventListener('mouseleave', () => {
            gsap.to(edgesMat, { opacity: 0, duration: 0.4 });
            isDragging = false;
        });

        // Drag rotate
        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            prevDragX = e.clientX;
            prevDragY = e.clientY;
        });
        window.addEventListener('mouseup', () => { isDragging = false; });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            dragVelX = (e.clientX - prevDragX) * 0.005;
            dragVelY = (e.clientY - prevDragY) * 0.005;
            prevDragX = e.clientX;
            prevDragY = e.clientY;
        });

        // Scroll speed
        let scrollSpeed = 1;
        window.addEventListener('scroll', () => {
            scrollSpeed = 1 + window.scrollY * 0.001;
        });

        // Animate
        const clock = new THREE.Clock();
        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            // Base rotation
            mainMesh.rotation.x += 0.003 * scrollSpeed;
            mainMesh.rotation.y += 0.005 * scrollSpeed;
            wireMesh.rotation.copy(mainMesh.rotation);
            edgesLine.rotation.copy(mainMesh.rotation);

            // Drag inertia
            accDragX += dragVelX;
            accDragY += dragVelY;
            dragVelX *= 0.95;
            dragVelY *= 0.95;
            mainMesh.rotation.y += accDragX * 0.1;
            mainMesh.rotation.x += accDragY * 0.1;
            accDragX *= 0.96;
            accDragY *= 0.96;

            // Mouse parallax
            targetRotX = mouseY * 0.15;
            targetRotY = mouseX * 0.15;
            camera.rotation.x += (targetRotX - camera.rotation.x) * 0.05;
            camera.rotation.y += (targetRotY - camera.rotation.y) * 0.05;

            // Particle float
            particles.rotation.y = t * 0.05;
            particles.rotation.x = t * 0.02;

            renderer.render(scene, camera);
        }
        animate();
    }

    // ═══════════ THREE.JS — SHOWCASE SCENE ═══════════
    function initShowcaseScene() {
        const canvas = document.getElementById('showcaseCanvas');
        if (!canvas) return;

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(C.void, 0.02);

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, 8);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(C.void);

        function resize() {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        }
        window.addEventListener('resize', resize);

        // Lights
        scene.add(new THREE.AmbientLight(C.white, 0.2));
        const dLight = new THREE.DirectionalLight(C.white, 0.6);
        dLight.position.set(3, 5, 5);
        scene.add(dLight);

        // Objects
        const objects = [];

        // Rotating cubes
        for (let i = 0; i < 6; i++) {
            const size = 0.3 + Math.random() * 0.4;
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshStandardMaterial({
                color: C.ebony,
                metalness: 0.5,
                roughness: 0.4,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(
                (Math.random() - 0.5) * 12,
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 6
            );
            mesh.userData = {
                rotSpeed: { x: (Math.random() - 0.5) * 0.02, y: (Math.random() - 0.5) * 0.02 },
                floatOffset: Math.random() * Math.PI * 2,
                baseY: mesh.position.y,
            };
            scene.add(mesh);
            objects.push(mesh);
        }

        // Wireframe torus
        const torusGeo = new THREE.TorusGeometry(1.2, 0.3, 16, 40);
        const torusMat = new THREE.MeshBasicMaterial({
            color: C.coal,
            wireframe: true,
            transparent: true,
            opacity: 0.4,
        });
        const torus = new THREE.Mesh(torusGeo, torusMat);
        torus.position.set(3, 0, -2);
        scene.add(torus);

        // Wireframe torus 2
        const torus2Geo = new THREE.TorusGeometry(0.8, 0.2, 12, 30);
        const torus2 = new THREE.Mesh(torus2Geo, torusMat.clone());
        torus2.position.set(-4, 1, -1);
        scene.add(torus2);

        // Particles
        const pCount = 600;
        const pPos = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 20;
            pPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 10;
        }
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
            color: C.midnight,
            size: 0.03,
            transparent: true,
            opacity: 0.5,
        });
        const pPoints = new THREE.Points(pGeo, pMat);
        scene.add(pPoints);

        // Scroll-driven camera
        const showcaseSection = document.getElementById('showcase');

        gsap.registerPlugin(ScrollTrigger);

        ScrollTrigger.create({
            trigger: showcaseSection,
            start: 'top bottom',
            end: 'bottom top',
            onUpdate: (self) => {
                const p = self.progress;
                camera.position.x = Math.sin(p * Math.PI) * 3;
                camera.position.y = Math.cos(p * Math.PI * 0.5) * 2;
                camera.lookAt(0, 0, 0);
            },
        });

        // Animate
        const clock = new THREE.Clock();
        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            objects.forEach((obj) => {
                obj.rotation.x += obj.userData.rotSpeed.x;
                obj.rotation.y += obj.userData.rotSpeed.y;
                obj.position.y = obj.userData.baseY + Math.sin(t + obj.userData.floatOffset) * 0.3;
            });

            torus.rotation.x = t * 0.3;
            torus.rotation.y = t * 0.15;
            torus2.rotation.x = t * -0.2;
            torus2.rotation.z = t * 0.25;

            pPoints.rotation.y = t * 0.03;

            renderer.render(scene, camera);
        }
        animate();
    }

    // ═══════════ GSAP ANIMATIONS ═══════════
    function initAnimations() {
        gsap.registerPlugin(ScrollTrigger);

        // Cards, stats, etc — scroll reveals
        gsap.utils.toArray('[data-animate]').forEach((el) => {
            gsap.to(el, {
                opacity: 1,
                y: 0,
                duration: 0.8,
                ease: 'power3.out',
                scrollTrigger: {
                    trigger: el,
                    start: 'top 85%',
                    once: true,
                },
            });
        });

        // Section headers
        gsap.utils.toArray('.section-header-landing').forEach((header) => {
            gsap.from(header, {
                opacity: 0,
                y: 40,
                duration: 0.8,
                ease: 'power3.out',
                scrollTrigger: {
                    trigger: header,
                    start: 'top 85%',
                    once: true,
                },
            });
        });

        // Hero entrance
        gsap.from('.hero-badge', { opacity: 0, y: 30, duration: 0.6, delay: 0.2 });
        gsap.from('.hero-title', { opacity: 0, y: 40, duration: 0.8, delay: 0.4 });
        gsap.from('.hero-subtitle', { opacity: 0, y: 30, duration: 0.7, delay: 0.6 });
        gsap.from('.hero-buttons', { opacity: 0, y: 30, duration: 0.7, delay: 0.8 });
        gsap.from('.hero-stats-mini', { opacity: 0, y: 20, duration: 0.6, delay: 1 });
        gsap.from('.hero-canvas-wrapper', { opacity: 0, scale: 0.9, duration: 1, delay: 0.5, ease: 'power2.out' });

        // Stat count-up
        gsap.utils.toArray('.stat-number').forEach((el) => {
            const target = parseInt(el.dataset.count, 10);
            ScrollTrigger.create({
                trigger: el,
                start: 'top 85%',
                once: true,
                onEnter: () => {
                    gsap.to(el, {
                        duration: 2,
                        ease: 'power2.out',
                        onUpdate: function () {
                            el.textContent = Math.round(this.progress() * target).toLocaleString();
                        },
                    });
                },
            });
        });

        // Showcase content
        gsap.from('.showcase-content', {
            opacity: 0,
            y: 60,
            duration: 1,
            scrollTrigger: {
                trigger: '.showcase',
                start: 'top 60%',
                once: true,
            },
        });
    }

    // ═══════════ TESTIMONIALS SLIDER ═══════════
    function initSlider() {
        const track = document.getElementById('testimonialTrack');
        const dots = document.querySelectorAll('.dot');
        let current = 0;

        function goTo(index) {
            current = index;
            track.style.transform = `translateX(-${current * 100}%)`;
            dots.forEach((d, i) => d.classList.toggle('active', i === current));
        }

        dots.forEach((dot) => {
            dot.addEventListener('click', () => goTo(parseInt(dot.dataset.index, 10)));
        });

        // Auto-advance
        setInterval(() => {
            goTo((current + 1) % dots.length);
        }, 5000);
    }

    // ═══════════ SMOOTH SCROLL ═══════════
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ═══════════ INIT ═══════════
    window.addEventListener('DOMContentLoaded', () => {
        initHeroScene();
        initShowcaseScene();
        initAnimations();
        initSlider();
    });
})();

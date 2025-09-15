const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Set ffmpeg path - with error handling
try {
    if (ffmpegStatic) {
        ffmpeg.setFfmpegPath(ffmpegStatic);
    }
} catch (error) {
    console.warn('FFmpeg not available - video thumbnails will be skipped');
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.static('.'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'portfolio-cms-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Default admin credentials (change these!)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_HASH || '$2a$10$7aWZ7hfsicl30ut2ksJVMeJzc2tBzb/JWe7Bn.JnK6S30p8by6IOC'; // 'portfolio2024'

// Ensure directories exist
const ensureDirectories = () => {
    const dirs = ['uploads', 'uploads/images', 'uploads/videos', 'uploads/pdfs', 'uploads/temp'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// Load projects data
const loadProjects = () => {
    try {
        if (fs.existsSync('data/projects.json')) {
            return JSON.parse(fs.readFileSync('data/projects.json', 'utf8'));
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
    
    // Return default projects if file doesn't exist
    return {
        'newport-flight-boats': {
            title: 'Newport Flight Boats',
            medium: 'Photography',
            description: 'A series capturing the serene beauty of boats in Newport harbor, exploring the relationship between human-made vessels and natural water environments.',
            images: ['images/newport_flight_boats.jpg'],
            videos: [],
            pdfs: [],
            order: 2
        }
    };
};

// Load site settings
const loadSettings = () => {
    try {
        if (fs.existsSync('data/settings.json')) {
            return JSON.parse(fs.readFileSync('data/settings.json', 'utf8'));
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
    
    // Default settings
    return {
        heroTitle: 'Fotógrafo y Artista Visual',
        heroSubtitle: 'Capturando momentos únicos a través de mi lente',
        contactTitle: 'Contacto',
        contactText: '¿Interesado en trabajar juntos?',
        contactEmail: 'tu@email.com'
    };
}

// Save site settings
const saveSettings = (settings) => {
    try {
        fs.writeFileSync('data/settings.json', JSON.stringify(settings, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// Save projects data
const saveProjects = (projects) => {
    try {
        if (!fs.existsSync('data')) {
            fs.mkdirSync('data');
        }
        fs.writeFileSync('data/projects.json', JSON.stringify(projects, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving projects:', error);
        return false;
    }
};

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, 'uploads/images/');
        } else if (file.mimetype.startsWith('video/')) {
            cb(null, 'uploads/videos/');
        } else {
            cb(null, 'uploads/temp/');
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|webm|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'application/pdf';
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images, videos, and PDFs are allowed!'));
        }
    }
});

// Initialize
ensureDirectories();
let projects = loadProjects();

// Routes

// Authentication routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && await bcrypt.compare(password, ADMIN_PASSWORD)) {
        req.session.authenticated = true;
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

// Projects routes
app.get('/api/projects', (req, res) => {
    res.json(projects);
});

app.get('/api/projects/:id', (req, res) => {
    const project = projects[req.params.id];
    if (project) {
        res.json(project);
    } else {
        res.status(404).json({ error: 'Project not found' });
    }
});

app.post('/api/projects/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { title, medium, description, images, videos, pdfs, order } = req.body;
    
    projects[id] = {
        title,
        medium,
        description,
        images: images || [],
        videos: videos || [],
        pdfs: pdfs || [],
        order: order || Object.keys(projects).length + 1
    };
    
    if (saveProjects(projects)) {
        res.json({ success: true, project: projects[id] });
    } else {
        res.status(500).json({ error: 'Failed to save project' });
    }
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    if (projects[id]) {
        delete projects[id];
        if (saveProjects(projects)) {
            res.json({ success: true, message: 'Project deleted' });
        } else {
            res.status(500).json({ error: 'Failed to delete project' });
        }
    } else {
        res.status(404).json({ error: 'Project not found' });
    }
});

// Settings routes
app.get('/api/settings', (req, res) => {
    const settings = loadSettings();
    res.json(settings);
});

app.post('/api/settings', requireAuth, (req, res) => {
    const settings = req.body;
    
    if (saveSettings(settings)) {
        // Regenerate static files with new settings
        updateIndexHtml();
        res.json({ success: true, message: 'Settings saved and site updated' });
    } else {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Hero image update route
app.post('/api/hero-image', requireAuth, (req, res) => {
    const { heroImage } = req.body;
    
    if (heroImage) {
        // Update the hero image in index.html
        let indexContent = fs.readFileSync('index.html', 'utf8');
        
        // Replace the login overlay background image
        const loginOverlayRegex = /background-image: url\(['"]*([^'"]*)['"]*\)/;
        if (loginOverlayRegex.test(indexContent)) {
            indexContent = indexContent.replace(
                loginOverlayRegex,
                `background-image: url('${heroImage}')`
            );
        } else {
            // If pattern not found, try to add it to the .login-overlay class
            const loginOverlayClassRegex = /(\.login-overlay\s*\{[^}]*)/;
            if (loginOverlayClassRegex.test(indexContent)) {
                indexContent = indexContent.replace(
                    loginOverlayClassRegex,
                    `$1background-image: url('${heroImage}');\n            `
                );
            }
        }
        
        // Write the updated content back to index.html
        if (fs.writeFileSync('index.html', indexContent)) {
            res.json({ success: true, message: 'Hero image updated successfully' });
        } else {
            res.status(500).json({ error: 'Failed to update hero image' });
        }
    } else {
        res.status(400).json({ error: 'No hero image URL provided' });
    }
});

// File upload routes
app.post('/api/upload', requireAuth, upload.array('files', 20), async (req, res) => {
    try {
        const processedFiles = [];
        
        for (const file of req.files) {
            let processedFile = {
                originalName: file.originalname,
                filename: file.filename,
                path: file.path,
                mimetype: file.mimetype,
                size: file.size
            };
            
            if (file.mimetype.startsWith('image/')) {
                // Optimize image
                const optimizedPath = path.join('uploads/images', 'opt_' + file.filename);
                await sharp(file.path)
                    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toFile(optimizedPath);
                
                processedFile.optimizedPath = optimizedPath;
                processedFile.type = 'image';
                processedFile.url = '/uploads/images/opt_' + file.filename;
            } else if (file.mimetype.startsWith('video/')) {
                // Generate thumbnail for video (if ffmpeg is available)
                const thumbnailPath = path.join('uploads/images', 'thumb_' + path.parse(file.filename).name + '.jpg');
                
                try {
                    await new Promise((resolve, reject) => {
                        ffmpeg(file.path)
                            .screenshots({
                                count: 1,
                                folder: 'uploads/images',
                                filename: 'thumb_' + path.parse(file.filename).name + '.jpg',
                                timemarks: ['10%']
                            })
                            .on('end', resolve)
                            .on('error', reject);
                    });
                    processedFile.thumbnail = '/uploads/images/thumb_' + path.parse(file.filename).name + '.jpg';
                } catch (error) {
                    console.warn('Could not generate video thumbnail:', error.message);
                    // Use a default video icon or the video itself as thumbnail
                    processedFile.thumbnail = null;
                }
                
                processedFile.type = 'video';
                processedFile.url = '/uploads/videos/' + file.filename;
            } else if (file.mimetype === 'application/pdf') {
                // Handle PDF files
                const pdfPath = path.join('uploads/pdfs', file.filename);
                fs.renameSync(file.path, pdfPath);
                
                processedFile.type = 'pdf';
                processedFile.url = '/uploads/pdfs/' + file.filename;
            }
            
            processedFiles.push(processedFile);
        }
        
        res.json({ success: true, files: processedFiles });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// Serve admin interface
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Update project order
app.post('/api/projects-order', requireAuth, (req, res) => {
    const { order } = req.body; // Array of project IDs in new order
    
    order.forEach((projectId, index) => {
        if (projects[projectId]) {
            projects[projectId].order = index + 1;
        }
    });
    
    if (saveProjects(projects)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// Regenerate static files
app.post('/api/regenerate', requireAuth, (req, res) => {
    try {
        console.log('Regenerating static files...');
        console.log('Current projects data:', JSON.stringify(projects, null, 2));
        
        // Update the project-template.html file with new project data
        let templateContent = fs.readFileSync('project-template.html', 'utf8');
        
        // Find and replace the projects object in the JavaScript
        const projectsJson = JSON.stringify(projects, null, 10);
        
        // More robust regex to find the projects object
        const projectsRegex = /const projects = \{[\s\S]*?\n\s*\};/;
        
        if (projectsRegex.test(templateContent)) {
            const updatedContent = templateContent.replace(
                projectsRegex,
                `const projects = ${projectsJson};`
            );
            
            fs.writeFileSync('project-template.html', updatedContent);
            console.log('Successfully updated project-template.html');
            
            // Also update the main index.html with new project links
            updateIndexHtml();
            
            res.json({ success: true, message: 'Static files regenerated successfully' });
        } else {
            throw new Error('Could not find projects object in template');
        }
    } catch (error) {
        console.error('Regeneration error:', error);
        res.status(500).json({ error: 'Failed to regenerate files: ' + error.message });
    }
});

// Update index.html with current project data
function updateIndexHtml() {
    try {
        let indexContent = fs.readFileSync('index.html', 'utf8');
        const settings = loadSettings();
        
        // Update site text content
        if (settings.heroTitle) {
            indexContent = indexContent.replace(
                /<h1 class="hero-title">.*?<\/h1>/,
                `<h1 class="hero-title">${settings.heroTitle}</h1>`
            );
        }
        
        if (settings.heroSubtitle) {
            indexContent = indexContent.replace(
                /<p class="hero-subtitle">.*?<\/p>/,
                `<p class="hero-subtitle">${settings.heroSubtitle}</p>`
            );
        }
        
        if (settings.contactTitle) {
            indexContent = indexContent.replace(
                /<h2 class="contact-title">.*?<\/h2>/,
                `<h2 class="contact-title">${settings.contactTitle}</h2>`
            );
        }
        
        if (settings.contactText) {
            indexContent = indexContent.replace(
                /<p class="contact-text">.*?<\/p>/,
                `<p class="contact-text">${settings.contactText}</p>`
            );
        }
        
        if (settings.contactEmail) {
            indexContent = indexContent.replace(
                /href="mailto:.*?"/,
                `href="mailto:${settings.contactEmail}"`
            );
        }
        
        // Update the project links mapping
        const sortedProjects = Object.entries(projects)
            .sort(([,a], [,b]) => (a.order || 0) - (b.order || 0));
        
        const projectLinksObj = {};
        sortedProjects.forEach(([id, project]) => {
            projectLinksObj[project.title] = id;
        });
        
        // Update the project links object
        const projectLinksRegex = /const projectLinks = \{[\s\S]*?\};/;
        if (projectLinksRegex.test(indexContent)) {
            indexContent = indexContent.replace(
                projectLinksRegex,
                `const projectLinks = ${JSON.stringify(projectLinksObj, null, 12)};`
            );
        }
        
        // Update the actual HTML grid structure
        const projectsGridHtml = sortedProjects.map(([id, project]) => {
            const primaryImage = project.images && project.images.length > 0 ? project.images[0] : 'https://via.placeholder.com/500x500/000000/ffffff?text=NO+IMAGE';
            
            return `            <!-- ${project.title} -->
            <div class="work-item">
                <img src="${primaryImage}" 
                     alt="${project.title}" class="work-image">
                <div class="work-overlay">
                    <h3 class="work-title">${project.title}</h3>
                    <p class="work-medium">${project.medium}</p>
                </div>
            </div>`;
        }).join('\n\n');
        
        // Replace the entire works grid content
        const worksGridRegex = /<div class="works-grid">[\s\S]*?<\/div>\s*<\/section>/;
        const newWorksGrid = `<div class="works-grid">
${projectsGridHtml}
        </div>
    </section>`;
        
        if (worksGridRegex.test(indexContent)) {
            indexContent = indexContent.replace(worksGridRegex, newWorksGrid);
        }
        
        fs.writeFileSync('index.html', indexContent);
        console.log('Successfully updated index.html with new project grid');
    } catch (error) {
        console.error('Error updating index.html:', error);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Portfolio CMS running at http://localhost:${PORT}`);
    console.log(`📊 Admin interface: http://localhost:${PORT}/admin`);
    console.log(`🔑 Default login: admin / portfolio2024`);
});
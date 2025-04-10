require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('html-pdf');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 50 
});


app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/api/generate-resume', limiter);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const activeDownloads = new Set();

async function createProfessionalContent(text, context, type) {
  try {
    const prompt = type === 'experience' 
      ? `Generate 3 concise, professional bullet points for this work experience:
         Position: ${context.position} at ${context.company}
         Description: ${text}

         Guidelines:
         - Begin each bullet with a strong action verb
         - Mention specific tools, technologies, or methodologies used
         - Focus on tangible outcomes or contributions
         - Do not include placeholders or vague percentages
         - Each bullet should be a single, impactful sentence (max 20 words)`
      : type === 'project'
      ? `Generate exactly 3 professional and effective bullet points for the following project:
         Title: ${context.title}
         Description: ${text}

         Guidelines:
         - Clearly state the objective or purpose of the project
         - Highlight specific tools, frameworks, or technologies used
         - Emphasize key achievements or real-world results
         - No placeholders, no vague terms, no speculative language
         - Each point should be direct, formal, and suitable for a resume (max 20 words)`
      : `Rewrite the following text into 2 polished, concise, and professional sentences without placeholders or vague terms: ${text}`;

    const result = await model.generateContent(prompt);
    return result.response.text()
      .replace(/\[.*?\]/g, '')
      .replace(/\b(?:optional|e\.g\.|quantifiable).*?\./gi, '')
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\s*-\s*/, '').trim());
  } catch (error) {
    console.error("Content Generation Error:", error);
    if (type === 'experience' || type === 'project') {
      return text.split('\n').filter(line => line.trim());
    }
    return [text];
  }
}


app.post('/api/generate-resume', async (req, res) => {
  try {
    const userData = req.body;
    
    if (!userData.personalInfo?.name || !userData.personalInfo?.email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    userData.skills = (userData.skills || []).map(skill => 
      skill.trim().replace(/\b\w/g, l => l.toUpperCase())
    ).filter(Boolean);

    try {
      userData.careerObjective = await createProfessionalContent(
        userData.careerObjective || `Computer Science student with ${userData.skills.slice(0, 3).join(', ')} skills`,
        null,
        'summary'
      ).then(arr => arr.join(' '));
    } catch (error) {
      userData.careerObjective = userData.careerObjective || `Computer Science student with ${userData.skills.slice(0, 3).join(', ')} skills`;
    }

    if (userData.experience) {
      for (const exp of userData.experience) {
        if (exp.responsibilities?.length > 0) {
          try {
            exp.enhancedPoints = await createProfessionalContent(
              exp.responsibilities.join('\n'),
              { position: exp.position, company: exp.company },
              'experience'
            );
          } catch (error) {
            exp.enhancedPoints = exp.responsibilities;
          }
        }
      }
    }

    if (userData.projects) {
      for (const project of userData.projects) {
        if (project.description?.trim()) {
          try {
            project.enhancedPoints = await createProfessionalContent(
              project.description,
              { title: project.title },
              'project'
            );
          } catch (error) {
            project.enhancedPoints = [project.description];
          }
        }
      }
    }

    userData.certifications = (userData.certifications || []).map(cert => {
      if (typeof cert === 'string') {
        return { name: cert };
      }
      return {
        name: cert.name || cert.title || '',
        issuer: cert.issuer || '',
        date: cert.date || ''
      };
    }).filter(cert => cert.name.trim());

    userData.achievements = (userData.achievements || []).map(ach => {
      if (typeof ach === 'string') return ach;
      return ach.title || ach.description || '';
    }).filter(Boolean);

    userData.languages = userData.languages || [
      { language: "English", proficiency: "Fluent" }
    ];

    const htmlContent = generateResumeHTML(userData);
    
    const pdfFilename = `${Date.now()}_${Math.floor(Math.random() * 1000)}_${userData.personalInfo.name.replace(/\s+/g, '_')}_resume.pdf`;
    const pdfPath = path.join(__dirname, 'resumes', pdfFilename);
    
    if (!fs.existsSync(path.join(__dirname, 'resumes'))) {
      fs.mkdirSync(path.join(__dirname, 'resumes'));
    }

    if (fs.existsSync(path.join(__dirname, 'resumes'))) {
      const files = fs.readdirSync(path.join(__dirname, 'resumes'))
        .filter(file => file.endsWith('.pdf'))
        .map(file => ({
          name: file,
          time: fs.statSync(path.join(__dirname, 'resumes', file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time)
        .map(file => file.name);
      
      if (files.length > 5) {
        for (let i = 5; i < files.length; i++) {
          fs.unlinkSync(path.join(__dirname, 'resumes', files[i]));
        }
      }
    }

    const pdfOptions = { 
      format: 'Letter',
      border: "10mm",
      timeout: 30000
    };

    await new Promise((resolve, reject) => {
      pdf.create(htmlContent, pdfOptions).toFile(pdfPath, (err) => {
        if (err) {
          console.error('PDF generation error:', err);
          return reject(new Error('Failed to generate PDF'));
        }
        resolve();
      });
    });

    res.json({ pdfFilename });

  } catch (error) {
    console.error('Error generating resume:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/download-resume/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'resumes', req.params.filename);
  
  if (activeDownloads.has(req.params.filename)) {
    return res.status(429).send('Download already in progress');
  }

  activeDownloads.add(req.params.filename);

  if (!fs.existsSync(filePath)) {
    activeDownloads.delete(req.params.filename);
    return res.status(404).send('Resume not found');
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  
  const fileStream = fs.createReadStream(filePath);
  fileStream.on('error', (err) => {
    console.error('File stream error:', err);
    activeDownloads.delete(req.params.filename);
    if (!res.headersSent) {
      res.status(500).send('Error streaming file');
    }
  });

  res.download(filePath, (err) => {
    activeDownloads.delete(req.params.filename);
    
    if (err) {
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).send('Download failed');
      }
    }
    
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkErr) {
      console.error('File deletion error:', unlinkErr);
    }
  });
});

function generateResumeHTML(data) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${data.personalInfo.name}'s Resume</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; line-height: 1.4; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #2c3e50; padding-bottom: 8px; }
    h1 { color: #2c3e50; margin: 5px 0; font-size: 24px; text-transform: uppercase; }
    .contact-info { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; font-size: 0.9em; }
    .section { margin-bottom: 15px; page-break-inside: avoid; }
    .section-title { color: #2c3e50; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 8px; font-size: 17px; text-transform: uppercase; }
    .job-header { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .job-title { font-weight: bold; }
    .company { font-style: italic; }
    .date { color: #666; font-size: 0.85em; }
    ul { margin: 5px 0 5px 15px; padding-left: 5px; }
    li { margin-bottom: 4px; font-size: 0.9em; }
    .skills-container { display: flex; flex-wrap: wrap; gap: 6px; }
    .skill-tag { background: #f0f0f0; padding: 3px 10px; border-radius: 3px; font-size: 0.85em; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    @media print { body { padding: 0; } a { color: #1a73e8 !important; text-decoration: none !important; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${data.personalInfo.name.toUpperCase()}</h1>
    <div class="contact-info">
      ${data.personalInfo.phone ? `📞 ${data.personalInfo.phone}` : ''}
      ✉️ ${data.personalInfo.email}
      ${data.personalInfo.linkedin ? `🔗 <a href="${data.personalInfo.linkedin}">LinkedIn</a>` : ''}
      ${data.personalInfo.github ? `🐱 <a href="${data.personalInfo.github}">GitHub</a>` : ''}
      ${data.personalInfo.portfolio ? `🌐 <a href="${data.personalInfo.portfolio}">Portfolio</a>` : ''}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Professional Summary</h2>
    <p style="font-size: 0.95em;">${data.careerObjective}</p>
  </div>

  <div class="section">
    <h2 class="section-title">Technical Skills</h2>
    <div class="skills-container">
      ${data.skills?.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
    </div>
  </div>

  ${data.experience?.length > 0 ? `
  <div class="section">
    <h2 class="section-title">Professional Experience</h2>
    ${data.experience.map(exp => `
      <div>
        <div class="job-header">
          <span class="job-title">${exp.position}</span>
          <span class="date">${exp.startDate} - ${exp.endDate || 'Present'}</span>
        </div>
        <div class="company">${exp.company}${exp.location ? `, ${exp.location}` : ''}</div>
        <ul>
          ${exp.enhancedPoints?.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
  </div>` : ''}

  ${data.projects?.length > 0 ? `
  <div class="section">
    <h2 class="section-title">Projects</h2>
    ${data.projects.map(proj => `
      <div>
        <div class="job-header">
          <span class="job-title">${proj.title}</span>
          ${proj.date ? `<span class="date">${proj.date}</span>` : ''}
        </div>
        ${proj.technologies?.length ? `<div style="font-size:0.85em;margin:3px 0 5px;">Technologies: ${proj.technologies.join(', ')}</div>` : ''}
        <ul>
          ${proj.enhancedPoints?.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>
    `).join('')}
  </div>` : ''}

  <div class="section">
    <h2 class="section-title">Education</h2>
    ${data.education?.map(edu => `
      <div>
        <div class="job-header">
          <span class="job-title">${edu.degree}</span>
          <span class="date">${edu.year}</span>
        </div>
        <div class="company">${edu.institution}${edu.location ? `, ${edu.location}` : ''}</div>
        ${edu.gpa ? `<div style="font-size:0.85em;">GPA: ${edu.gpa}</div>` : ''}
      </div>
    `).join('')}
  </div>

  <div class="section two-col">
    <div>
      <h2 class="section-title">Certifications</h2>
      <ul>
        ${data.certifications?.length > 0 
          ? data.certifications.map(cert => `
            <li>${cert.name}${cert.issuer ? ` (${cert.issuer})` : ''}${cert.date ? ` - ${cert.date}` : ''}</li>
          `).join('')
          : '<li>No certifications added</li>'}
      </ul>
    </div>
    
    <div>
      <h2 class="section-title">Achievements</h2>
      <ul>
        ${data.achievements?.length > 0
          ? data.achievements.map(ach => `<li>${ach}</li>`).join('')
          : '<li>No achievements added</li>'}
      </ul>
    </div>
    
    <div>
      <h2 class="section-title">Languages</h2>
      <ul>
        ${data.languages?.map(lang => `
          <li>${lang.language}${lang.proficiency ? ` (${lang.proficiency})` : ''}</li>
        `).join('')}
      </ul>
    </div>
  </div>
</body>
</html>`;
}

if (!fs.existsSync(path.join(__dirname, 'resumes'))) {
  fs.mkdirSync(path.join(__dirname, 'resumes'));
}

app.listen(port, () => {
  console.log(`Resume Builder running on port ${port}`);
});
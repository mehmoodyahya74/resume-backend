require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-core');
const cors = require('cors');
const fs = require('fs');

const app = express();

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

let generateContent;
try {
  const aiService = require("./ai-service");
  generateContent = aiService.generateContent;
  console.log("✅ AI service loaded successfully");
} catch (error) {
  console.error("❌ Error loading AI service:", error.message);
  generateContent = async (prompt) => {
    console.log("Using fallback AI service");
    return `Professional response: ${prompt.substring(0, 100)}...`;
  };
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

function findChromePath() {
  const paths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\chrome.exe',
  ];
  
  for (const path of paths) {
    if (path && fs.existsSync(path)) {
      return path;
    }
  }
  return null;
}

function filterAIResponse(text) {
  if (!text || typeof text !== 'string') return text;
  
  let filtered = text.replace(/[#*]/g, '');
  
  const bannedPatterns = [
    /^Of course[,.]? Here are/i,
    /^Here are \d+[-+]\d+ (exceptional|professional) (resume )?(bullet points|summary)/i,
    /^Here are \d+[-+] \w+ (bullet points|sentences)/i,
    /^Here are some (suggested|recommended) (bullet points|skills|summary)/i,
    /^I('ll| will) (now )?(generate|create|provide)/i,
    /^Here (is|are) (a|the) (professional|exceptional|comprehensive)/i,
    /crafted to meet your specifications/i,
    /tailored for a .+ role/i,
    /^As (requested|per your request)/i,
    /^Below (is|are) .+ (bullet points|summary|skills)/i,
    /^Generated (content|summary|bullets)/i,
    /designed to .+ and impact/i,
    /tells? a compelling story/i,
    /^Software Engineer,? Comprehensive Skills List/i,
    /^Comprehensive Skills List for/i,
    /^TECHNICAL\/CORE COMPETENCIES:/i,
    /^PROFESSIONAL EXPERTISE:/i,
    /^LEADERSHIP & SOFT SKILLS:/i,
    /^INDUSTRY-SPECIFIC:/i
  ];
  
  const sentences = filtered.split(/(?<=[.!?])\s+/);
  
  const cleanSentences = sentences.filter(sentence => {
    const trimmed = sentence.trim();
    if (trimmed.length < 20) return false;
    const isBanned = bannedPatterns.some(pattern => pattern.test(trimmed));
    const hasStructure = 
      trimmed.toLowerCase().includes('here are') &&
      trimmed.toLowerCase().includes('exceptional') &&
      trimmed.toLowerCase().includes('resume') &&
      trimmed.toLowerCase().includes('bullet points');
    return !isBanned && !hasStructure;
  });
  
  if (cleanSentences.length === 0) {
    return 'Professional content generated.';
  }
  
  return cleanSentences.join(' ').trim();
}

app.post('/generate-pdf', async (req, res) => {
  let browser = null;
  
  try {
    const { html, fileName = 'resume.pdf' } = req.body;
    
    const chromePath = findChromePath();
    if (!chromePath) {
      return res.status(500).json({ error: 'Chrome not found' });
    }
    
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    const page = await browser.newPage();
    
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await page.evaluateHandle('document.fonts.ready');
    await page.waitForTimeout(500);
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.2in',
        right: '0.2in',
        bottom: '0.2in',
        left: '0.2in'
      },
      scale: 0.98,
      displayHeaderFooter: false
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdf);
    
  } catch (error) {
    console.error('PDF Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.post('/ai/generate-summary', async (req, res) => {
  try {
    console.log("Received request for generate-summary");
    const { title, years, skills, customInstructions } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Professional title is required" });
    }
    
    const prompt = `Create a professional summary for a ${title} with ${years || '5+'} years of experience.
    
IMPORTANT FORMAT RULES - STRICTLY FOLLOW THESE:
1. Generate EXACTLY 3-5 sentences (lines) ONLY
2. NO bullet points, NO numbered lists, NO markdown
3. NO bold text, NO asterisks, NO special formatting
4. Pure paragraph format - just sentences separated by spaces
5. Each sentence should be complete and professional
6. Output should be clean plain text only

KEY ELEMENTS TO INCLUDE:
• Start with a strong opening statement about ${title} expertise
• Include 2-3 quantifiable achievements or impacts
• Use action verbs: led, developed, optimized, implemented
• End with forward-looking career objective
• Focus on: ${skills || 'relevant skills'}

${customInstructions ? `SPECIAL REQUESTS: ${customInstructions}` : ''}

CRITICAL: Return ONLY the 3-5 sentence paragraph, no explanations, no labels, no additional text.`;

    console.log("Calling AI with strict paragraph formatting rules");
    const summary = await generateContent(prompt);
    
    const cleanSummary = filterAIResponse(summary);
    
    let finalSummary = cleanSummary
      .replace(/[•\-*]/g, '')
      .replace(/\n\s*\n/g, '\n')
      .replace(/^\s*[\d\.]+\s*/gm, '')
      .trim();
    
    finalSummary = finalSummary.split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length > 10)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log("Clean summary generated");
    res.json({ summary: finalSummary }); 
  } catch (error) {
    console.error("Summary generation error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/generate-bullets', async (req, res) => {
  try {
    const { title, position, company, context, customInstructions } = req.body;
    
    const roleToGenerate = position || title;
    
    if (!roleToGenerate) {
      return res.status(400).json({ error: "Position or title is required" });
    }
    
    const prompt = `Generate exceptional resume bullet points for ${roleToGenerate} role at ${company || 'a leading company'}.

${position && title && position !== title ? `Note: This is specifically for ${position} position within ${title} career track.` : ''}

Role context: ${context || 'Key responsibilities and achievements'}

${customInstructions ? `ADDITIONAL FOCUS REQUESTED: ${customInstructions}

Create bullet points that showcase ${roleToGenerate} expertise with emphasis on these areas:` : 'Focus on core role responsibilities:'}

REQUIREMENTS FOR EACH BULLET POINT:
• Start with powerful action verbs (orchestrated, spearheaded, revolutionized, accelerated, transformed)
• Include specific metrics and quantifiable results (increase by X%, reduce by Y%, manage $Z budget)
• Focus on business impact and value creation, not just duties
• Use industry-standard terminology for ATS compatibility
• Demonstrate progression and increasing responsibility
• Showcase both technical expertise and soft skills

Generate 5-7 bullet points specific to ${roleToGenerate} role.

${customInstructions ? `TAILOR to highlight: ${customInstructions}` : ''}`;

    const bullets = await generateContent(prompt);
    const cleanBullets = filterAIResponse(bullets);
    let finalBullets = cleanBullets;
    const bulletArray = finalBullets.split('\n').filter(b => b.trim() && b.includes('•'));
    
    if (bulletArray.length === 0) {
      const fallbackArray = finalBullets.split('\n').filter(b => b.trim() && (b.includes('-') || /^\d+\./.test(b)));
      res.json({ bullets: fallbackArray });
    } else {
      res.json({ bullets: bulletArray });
    }
    
  } catch (error) {
    console.error("Bullets generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/improve-text', async (req, res) => {
  try {
    const { text, customInstructions } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text content is required" });
    }
    
    const prompt = `Improve this professional summary text:

ORIGINAL TEXT:
"${text}"

${customInstructions ? `SPECIFIC REQUESTS: ${customInstructions}` : ''}

CRITICAL FORMATTING RULES - MUST FOLLOW:
1. Return ONLY a 3-5 sentence professional paragraph
2. NO bullet points, NO numbered lists, NO markdown
3. NO bold text, NO asterisks, NO special formatting
4. Pure paragraph format - sentences separated by spaces
5. Keep it concise and professional
6. Output should be clean plain text only

IMPROVEMENT GUIDELINES:
• Elevate language to professional level
• Add quantifiable metrics where appropriate
• Use powerful action verbs
• Optimize for ATS with relevant keywords
• Focus on achievements and results
• Ensure parallel structure and flow

IMPORTANT: If the original text has bullet points, CONVERT them to smooth paragraph sentences.
Return ONLY the improved 3-5 sentence paragraph, nothing else.`;

    const improved = await generateContent(prompt);
    const cleanImproved = filterAIResponse(improved);
    
    let finalImproved = cleanImproved
      .replace(/[•\-*]/g, '')
      .replace(/\n\s*\n/g, '\n')
      .replace(/^\s*[\d\.]+\s*/gm, '')
      .replace(/"/g, '')
      .trim();
    
    finalImproved = finalImproved.split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length > 5 && !line.toLowerCase().includes('improved text') && !line.toLowerCase().includes('enhanced version'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const sentences = finalImproved.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 6) {
      finalImproved = sentences.slice(0, 6).join('. ') + '.';
    }
    
    res.json({ improved: finalImproved });
    
  } catch (error) {
    console.error("Text improvement error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/suggest-skills', async (req, res) => {
  try {
    const { title, field, customInstructions } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Professional title is required" });
    }
    
    const prompt = `Provide a comprehensive skills list for a ${title} targeting ${field || 'competitive industry'} roles.

${customInstructions ? `SPECIFIC SKILL AREAS REQUESTED: ${customInstructions}

Prioritize skills related to these areas within ${title} context:` : 'Provide balanced skill set for general ${title} role:'}

CATEGORIZE SKILLS INTO:
1. TECHNICAL/CORE COMPETENCIES: Primary tools, technologies, and hard skills
2. PROFESSIONAL EXPERTISE: Domain knowledge and specialized capabilities
3. LEADERSHIP & SOFT SKILLS: Management, communication, strategic abilities
4. INDUSTRY-SPECIFIC: Relevant certifications, methodologies, frameworks

REQUIREMENTS:
• Include both foundational and advanced skills
• Balance between technical and transferable skills
• Prioritize in-demand, market-relevant competencies
• Include ATS keywords for optimal resume scanning
• Provide 12-18 total skills across categories
• Format as comma-separated list within categories

${customInstructions ? `SPECIAL FOCUS: Emphasize skills related to ${customInstructions} while maintaining ${title} relevance.` : 'Focus on skills that demonstrate both depth and breadth of expertise.'}`;

    const skills = await generateContent(prompt);
    const cleanSkills = filterAIResponse(skills);
    
    const skillsArray = cleanSkills
      .split(/[,\n•\-]/)
      .map(s => s.trim())
      .filter(s => {
        if (s.length < 2) return false;
        
        const bannedPhrases = [
          'comprehensive skills list',
          'technical/core competencies',
          'professional expertise',
          'leadership & soft skills',
          'industry-specific',
          'category',
          'skills list',
          'skills:',
          'skills for',
          '1. ',
          '2. ',
          '3. ',
          '4. '
        ];
        
        const lower = s.toLowerCase();
        const isBanned = bannedPhrases.some(phrase => lower.includes(phrase.toLowerCase()));
        
        const isHeader = lower.includes(':') || /^\d+\./.test(s);
        
        const isTooLong = s.length > 30;
        
        const isGeneric = [
          'primary tools',
          'hard skills',
          'soft skills',
          'domain knowledge',
          'methodologies',
          'frameworks',
          'certifications',
          'relevant certifications'
        ].some(phrase => lower.includes(phrase.toLowerCase()));
        
        return !isBanned && !isHeader && !isTooLong && !isGeneric;
      })
      .filter(s => s.length > 2)
      .slice(0, 20);
    
    res.json({ skills: skillsArray });
    
  } catch (error) {
    console.error("Skills suggestion error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/test', (req, res) => {
  console.log("Test endpoint called");
  res.json({ 
    message: 'Server is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    ai: 'DeepSeek',
    endpoints: [
      '/ai/generate-summary',
      '/ai/generate-bullets', 
      '/ai/improve-text',
      '/ai/suggest-skills',
      '/generate-pdf'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Resume Builder',
    port: process.env.PORT
  });
});

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`
  =========================================
  🚀 Server started successfully!
  =========================================
  Port: ${PORT}
  AI Provider: DeepSeek
  Status: Running
  
  Test endpoints:
  http://localhost:${PORT}/test
  http://localhost:${PORT}/health
  
  =========================================
  `);
});

server.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Trying ${parseInt(PORT) + 1}...`);
    app.listen(parseInt(PORT) + 1, () => {
      console.log(`Server started on port ${parseInt(PORT) + 1}`);
    });
  }
});
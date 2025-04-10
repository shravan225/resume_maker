# Steps to Run the AI Resume Maker Application

Here's how to set up and run your AI Resume Maker application:

## Prerequisites
1. **Node.js** (v14 or later) installed on your system
2. **npm** (comes with Node.js) or **yarn**
3. **Git** (optional, if cloning from GitHub)

## Setup Instructions

### 1. Clone the repository 

### 2. Install dependencies
```bash
npm install
```
This will install all required packages:
- express
- @google/generative-ai
- html-pdf
- dotenv
- cors
- body-parser
- express-rate-limit

### 3. Create the .env file
Create a `.env` file in the root directory with your Gemini API key:
```
GEMINI_API_KEY=AIzaSyATCqEyekPy-0DvC9_QXhCEch7dbQX9pRs
PORT=3000
```

### 4. Create required directories
The application needs a `resumes` directory to store generated PDFs:
```bash
mkdir resumes
```

### 5. Start the server
```bash
node server.js
```
or for automatic restarts during development:
```bash
npx nodemon server.js
```

### 6. Access the application
Open your browser and navigate to:
```
http://localhost:3000
```

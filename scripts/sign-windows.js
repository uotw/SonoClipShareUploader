// scripts/sign-windows.js - Windows code signing script
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

exports.default = async function(configuration) {
    const { path: filePath } = configuration;
    
    // Only sign executables and installers
    if (!filePath.endsWith('.exe') && !filePath.endsWith('.msi')) {
        console.log(`Skipping signing for ${path.basename(filePath)} (not an executable)`);
        return;
    }
    
    console.log(`Signing ${path.basename(filePath)}...`);
    
    // Certificate paths in current user's Documents/sign/ folder
    const userHome = os.homedir();
    const signDir = path.join(userHome, 'Documents', 'sign');
    const spcPath = path.join(signDir, 'authenticode.spc');
    const keyPath = path.join(signDir, 'authenticode.key');
    const pfxPath = path.join(signDir, 'authenticode.pfx');
    
    // Check if certificate files exist
    const hasOpenSSLCerts = fs.existsSync(spcPath) && fs.existsSync(keyPath);
    const hasPFXCert = fs.existsSync(pfxPath);
    
    if (!hasOpenSSLCerts && !hasPFXCert) {
        throw new Error(`Certificate files not found in ${signDir}. Need either:\n` +
                       `- authenticode.spc + authenticode.key (for osslsigncode)\n` +
                       `- authenticode.pfx (for signtool)`);
    }
    
    const timestampUrl = 'http://timestamp.comodoca.com/authenticode';
    
    try {
        if (hasPFXCert) {
            // Use Windows native signtool with PFX certificate
            await signWithSigntool(filePath, pfxPath, timestampUrl);
        } else {
            // Use osslsigncode with separate key/certificate files
            await signWithOsslsigncode(filePath, spcPath, keyPath, timestampUrl);
        }
        
        console.log(`Successfully signed ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`Failed to sign ${path.basename(filePath)}:`, error.message);
        throw error;
    }
};

async function signWithSigntool(filePath, pfxPath, timestampUrl) {
    // Check if signtool is available
    try {
        execSync('signtool /? >nul 2>&1', { stdio: 'ignore' });
    } catch (error) {
        throw new Error('signtool.exe not found. Install Windows SDK or Visual Studio.');
    }
    
    const signedPath = filePath + '.signed';
    
    // Copy file to temp location for signing
    execSync(`copy "${filePath}" "${signedPath}"`, { stdio: 'inherit' });
    
    let command;
    
    // Try with password prompt first
    try {
        // Note: This will prompt for password in console
        command = `signtool sign /f "${pfxPath}" /t "${timestampUrl}" /v "${signedPath}"`;
        execSync(command, { stdio: 'inherit' });
    } catch (error) {
        // If that fails, try with common password (not recommended for production)
        console.log('Password prompt failed, trying with environment variable...');
        const password = process.env.CODE_SIGN_PASSWORD;
        if (password) {
            command = `signtool sign /f "${pfxPath}" /p "${password}" /t "${timestampUrl}" /v "${signedPath}"`;
            execSync(command, { stdio: 'inherit' });
        } else {
            throw new Error('Certificate password required. Set CODE_SIGN_PASSWORD environment variable or use interactive mode.');
        }
    }
    
    // Replace original with signed version
    execSync(`move "${signedPath}" "${filePath}"`, { stdio: 'inherit' });
}

async function signWithOsslsigncode(filePath, spcPath, keyPath, timestampUrl) {
    // Check if osslsigncode is available
    try {
        execSync('osslsigncode --version >nul 2>&1', { stdio: 'ignore' });
    } catch (error) {
        throw new Error('osslsigncode not found. Install from: https://github.com/mtrojnar/osslsigncode/releases');
    }
    
    const signedPath = filePath + '.signed';
    
    const command = `osslsigncode sign -spc "${spcPath}" -key "${keyPath}" -t "${timestampUrl}" -in "${filePath}" -out "${signedPath}"`;
    
    execSync(command, { stdio: 'inherit' });
    
    // Replace original with signed version
    execSync(`move "${signedPath}" "${filePath}"`, { stdio: 'inherit' });
}

// Helper function to check signing tools availability
function checkSigningTools() {
    const tools = {
        signtool: false,
        osslsigncode: false
    };
    
    try {
        execSync('signtool /? >nul 2>&1', { stdio: 'ignore' });
        tools.signtool = true;
    } catch (e) {}
    
    try {
        execSync('osslsigncode --version >nul 2>&1', { stdio: 'ignore' });
        tools.osslsigncode = true;
    } catch (e) {}
    
    return tools;
}

// Export helper for debugging
exports.checkSigningTools = checkSigningTools;
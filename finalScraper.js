const puppeteer = require('puppeteer');
const fs = require('fs');

// Function to add data continuously to json file
function appendToJson(newContent, filePath) {
  try {
      // Read existing file
      let existingData = [];
      try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          existingData = JSON.parse(fileContent);
      } catch (error) {
          // File doesn't exist or is empty, start with empty array
          existingData = [];
      }

      // Add new content
      existingData.push(newContent);

      // Write back to file
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
  } catch (error) {
      console.error('Error appending to JSON:', error);
  }
}

// Delay function to make scraping harder to detect
function delay(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

// Function to scroll through webpage and load all content
async function autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.documentElement.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
  
          // If we've scrolled past the document height or haven't found new content
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100); // Scroll every 100ms
      });
    });
  
    // Wait a bit for any lazy-loaded content to appear
    await delay(1000);
}


// Function to check tiktok and twitter pages to see if video is contained within them
async function secondaryCheck(link, browser, platform, retryCount){

    try{
        // go to page and wait 
        let page = await browser.newPage();
        page.goto(link);
        await delay(3000);
        
        let videoFound = false;

        if(platform === 'tiktok'){
            videoFound = page.evaluate(() => {
                
                // Checks if error container exists
                const result1 = document.querySelector('div#embred-error-container') !== null;

                // Checks if a different error wrapper exists
                let result2 = true; 
                if(document.querySelector('#main-content-video_detail')){
                    result2 = Array.from(document.querySelector('#main-content-video_detail').firstChild.classList)[0].includes('ErrorWrapper')
                }

                // Returns true only if neither error page is displayed
                return !result2 && !result1;
            })
        }else if (platform === 'twitter'){

            // Checks if twitter page contains a video player
            videoFound = page.evaluate(() => {
            return document.querySelector(`div[data-testid="videoPlayer"]`) != null;
            });
        }

        // Close page and return result
        await page.close();
    return videoFound
    } catch (error){
        console.log("trying to go to new webpage again");
        if(retryCount < 3){
            await page.close();
            return secondaryCheck(link, browser, platform, retryCount + 1);
        }else{
            console.log("couldn't resolve");
        }
    }
}

// Main scraping function
async function scrapeSnoop(){

    // Launch browser
    let browser = await puppeteer.launch({
        headless: false,
        protocolTimeout: 60000
    });

    // Array to store all webpages to scrape
    let allPages = [];

    let page = await browser.newPage();

    // Go to pages where articles are contained when searching for 'Video' and save all the titles and urls
    for(let i = 1; i <= 6; i++){
        await page.goto(`https://www.snopes.com/search/?q=video#gsc.tab=0&gsc.q=video&gsc.page=${i}`);

        // Long delay to avoid captcha
        await delay(5000);

        const webpages = await page.evaluate(() => {    
            const articles = document.querySelectorAll('.gsc-result');
            return Array.from(articles).map(article => ({
                title: article.querySelector('.gs-title').textContent.trim(),
                url: article.querySelector('.gs-title a').getAttribute('href')
            }));
        }); 

        const newPages = [...allPages, ...webpages];
        allPages = newPages;
    }  
    
    // Variable to track how many pages have been scraped, will stop at 50
    let i = 0;
    let actual = 0;

    // Loops through all the webpages 
    for(const truePage of allPages.slice(55)){

        //Keep track of how many pages you've scraped so far
        console.log("NUMBER " + i);
        console.log("ACTUAL " + actual);
        // Skips any bad/invalid page titles which were scraped before
        if(truePage.title == 'Video'){
            actual++;
            continue;
        }

        // Go to the article and wait for 2 seconds and scroll through it
        await page.goto(truePage.url);
        await autoScroll(page);
        await delay(2000);

        // Get information about the title, representative text, veracity, and date
        let content = await page.evaluate(() => {
            let title = document.querySelector('h1').textContent.trim();
            let excerpt = document.querySelector('h2').textContent.trim();
            let veracity = document.querySelector('.rating_title_wrap');
            let date = document.querySelector('h3.publish_date').textContent.trim();

            // Some webpages may not have a veracity location, in which case it is an invalid page and should not count
            if(veracity){
                veracity = veracity.firstChild.textContent.trim();
            }else{
                return null;
            }

            return {title: title, excerpt: excerpt, veracity: veracity, date: date};
        });

        // Continues onto the next webpage if the current page is invalid
        if(!content){
            actual++;
            continue;
        }

        // Sometimes videos are stored in iframe tags, so we get all the iFrames contained within the page and the source video they're showing, if any
        let iFrames = await page.evaluate(() => {
          let final = Array.from(document.querySelectorAll('iframe')).map(frame => ({
            link: (frame.getAttribute('src') || frame.getAttribute('data-src'))
          })) 

          return final;
        })

        // Variable which will eventually store the source of a video, if it can be found
        let iFrameLink = null;

        // Loop through all the iframe links we get from before
        for (let iFram of iFrames){

            // Convert link to string
            let actualLink = String(iFram.link);

            // Sometimes tiktok embeds show deleted/unavailable videos, so a secondary check must be done to ensure it is showing a valid video
            if(actualLink.includes('tiktok.com')){
                if(await secondaryCheck(actualLink, browser, "tiktok", 0)){
                    iFrameLink = String(actualLink);
                    break;
                }
            
            // All other platforms are okay
            }else if(actualLink.includes("youtube.com") || actualLink.includes("instagram.com") || actualLink.includes("twitter.com") || actualLink.includes("x.com")
                || actualLink.includes("facebook.com") || actualLink.includes("c-span.org")){
                iFrameLink = String(actualLink);
                break;
            }
        }

        // Videos are also stored as href's in a tags, so those must be checked
        let regularLinks = await page.evaluate(() => {
            let aTags = Array.from(document.querySelectorAll('a')).map(a => ({
                href: a.href
            }));

            return aTags;
        })

        // Variable which will eventually store the source of a video stored within an a tag, if it can be found
        let trueLink = null;

        // Loop through all the links found before
        for(let href of regularLinks){

            let link = href.href;

            // Sometimes the a tag's do not contain an href 
            if(link == null){
                continue;
            }

            // Sometimes the links are stored within web archives, which is much slower to load, so we extract the actual link, and perserve the original
            let originalLink = link;
            if(link.includes("web.archive.org")){
              link = "https://" + link.split('/https://')[1];
            }

            // If a link includes youtube, it must have 'watch' if it is a webapge with a video
            if(link.includes('youtube.com') && link.includes('watch')){
                trueLink = String(originalLink);
                break;
            
            // Twitter pages must contain "status" to show a post, and not a general twitter page
            }else if((link.includes("twitter.com") || link.includes("x.com")) && link.includes("status")){

                // Checks if the twitter post contains a video, and if it does, save it
                let result = await secondaryCheck(link, browser, "twitter", 0);
                if(result){
                    trueLink = String(originalLink);
                    break;
                }
            
            // Checks if the link includes tiktok.com
            }else if(link.includes("tiktok.com")){

                // Makes a secondary check to make sure the video is still up
                let result = await secondaryCheck(link, browser, "tiktok", 0);
                if(result){
                    trueLink = String(originalLink);
                    break;
                }
            }else if(link.includes("instagram.com") || link.includes("facebook.com") || link.includes("c-span.org")){
                trueLink = String(originalLink);
                break;
            }
        }

        // The final source of a the video will be whichever link appeared first in the article
        let finalLink = await page.evaluate((iFrameLink, trueLink) => {
        
            // If both links could not be found then return null
            if(iFrameLink === null && trueLink === null){
                return null;

            // If only one type of link could not be found, return the other
            }else if(iFrameLink === null){
                return trueLink;
            }else if(trueLink === null){
                return iFrameLink;
            }else{
            
            console.log(iFrameLink);
            console.log(trueLink);

            // Find the original iframe html element
            let iFrame = document.querySelector(`iframe[src="${iFrameLink}"]`) || 
                document.querySelector(`iframe[data-src="${iFrameLink}"]`);

            // Find the original a tag for the other link
            let linkFrames = Array.from(document.querySelectorAll('a'));

            let linkFrame = null;

            for (const link of linkFrames) {
                console.log(link.href);
                if(link.href === trueLink){
                    linkFrame = link;
                    break;
                }
            }

            // Return whichever one appears closer to the top of the page
            let rect1 = iFrame.getBoundingClientRect().top;
            let rect2 = linkFrame.getBoundingClientRect().top;
            if(rect1 < rect2){
              return iFrameLink;
            }
            return trueLink;
          }
        }, iFrameLink, trueLink);

        // If a link for a video could not be found, continue to the next webpage
        if(finalLink == null){
            actual++;
          continue;
        }

        // Variable which will find the source
        let source = null;

        // Removes webarchive part of the link so just the original part is stored in the json file
        if(finalLink.includes("web.archive.org")){
            const cleanUrl = "https://" + finalLink.split('/https://')[1];
            finalLink = cleanUrl;
        }

        // Attributes source based on what is contained in the link
        if(finalLink.includes("youtube.com")){
            source = "Youtube";
        }else if(finalLink.includes("tiktok.com")){
            source = "Tiktok";
        }else if(finalLink.includes("x.com") || finalLink.includes("twitter.com")){
            source = "Twitter";
        }else if(finalLink.includes("instagram.com")){
            source = "Instagram";
        }else if(finalLink.includes("c-span.org")){
            source = "c-span"
        }else if(finalLink.includes("facebook.com")){
            source = "Facebook"
        }

        // Increment i and make final object
        i++;
        actual++;
        let finalContent = {
            Headline: content.title,
            Representative_Text: content.excerpt,
            Veracity: content.veracity,
            Date: content.date,
            Shareable_Video_Link: finalLink,
            Original_Source: source
        }

        // Log the content so you can keep track of progress and write it to the JSON file
        console.log(finalContent);
        appendToJson(finalContent, 'final.json');

        // Code to close browser and reset to avoid browser getting hung in the middle of scraping
        if((actual % 10) == 0){
            await browser.close();
            browser = await puppeteer.launch({
                headless: false,
                protocolTimeout: 30000
            });

            page = await browser.newPage();
        }

        // Stop once we get to 50 pages
        if(i == 50){
            break;
        } 
    } 
}

scrapeSnoop();
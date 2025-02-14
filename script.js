function createArticleElement(article) {
    const articleElement = document.createElement("div")
    articleElement.className = "article"
    articleElement.innerHTML = `
          <h2>${article.Headline}</h2>
          <a href="${article.Shareable_Video_Link}" target="_blank" rel="noopener noreferrer" class="video-link">Watch Video</a>
          <p>${article.Representative_Text}</p>
          <p class="veracity ${article.Veracity.toLowerCase()}">${article.Veracity}</p>
          <p>${article.Date}</p>
          <p>Original Source: ${article.Original_Source}</p>
          <textarea placeholder="Your thoughts on this clip..." rows="4"></textarea>
      `
    return articleElement
  }
  
  function renderArticles(articles) {
    const container = document.getElementById("articles-container")
    articles.forEach((article) => {
      const articleElement = createArticleElement(article)
      container.appendChild(articleElement)
    })
  }
  
  function loadArticles() {
    fetch("final.json")
      .then((response) => response.json())
      .then((data) => {
        renderArticles(data)
      })
      .catch((error) => {
        console.error("Error loading articles:", error)
      })
  }
  
  document.addEventListener("DOMContentLoaded", loadArticles)
debugging = false;

console.log("Loaded ingect.js");

(() => {
  let pages;

  debugLog("Called ingect.js");
  
  pages = document.getElementById("goBtn").childElementCount;
  browser.runtime.sendMessage({ type: "update_pages_count", pages: pages});

  function onMessage(message) {
    debugLog("Receive message")
    debugLog(message)
    if (message.type === "init_convert") {
      debugLog("Inject received init messsage");
      if(message.options === undefined || message.options === null) {
        console.error("Need options to start convert");
        return;
      }

      let options = {
        title: document.title,
        savemethod: message.options.savemethod,
        scale: message.options.savemethod === "png" ? message.options.scale * 0.25 : 1,
        from_page: message.options.from_page !== undefined && message.options.from_page !== null && message.options.from_page.length !== 0 ? Number(message.options.from_page) : 1,
        to_page: message.options.to_page !== undefined && message.options.to_page !== null && message.options.to_page.length !== 0 ? Number(message.options.to_page) : pages,
        safemode: message.options.safemode,
        slowmode: message.options.slowmode
      };

      console.log("Starting conversion with options");
      debugLog(options)
  
      generate_pdf(options);

      browser.runtime.sendMessage({ type: "close_option_modal"});
    }
  }

  browser.runtime.onMessage.addListener(onMessage);
  //btn_convert.click();

  async function generate_pdf(options) {
    let http = new XMLHttpRequest();
    let url = new URL(window.location);
    let bookURL = (url.origin + url.pathname).replace(/\/[^\/]+?$/, "/");
    console.log(url, bookURL);

    let svg_container = document.evaluate(
      '//*[@id="jpedal"]/div[2]/object',
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    let width = Number(svg_container.width);
    let height = Number(svg_container.height);
    debugLog("before pdfdoc");

    let pdf_doc = new PDFDocument({
      autoFirstPage: false,
      size: [width * options.scale, height * options.scale],
      margin: 0,
    });

    debugLog("------", width, height);
    debugLog(pdf_doc);

    let chunks = [];
    pdf_doc.pipe({
      // writable stream implementation
      write: (chunk) => chunks.push(chunk),
      end: () => {
        let pdfBlob = new Blob(chunks, {
          type: "application/octet-stream",
        });
        let blobUrl = URL.createObjectURL(pdfBlob);
        let a = document.createElement("a");
        a.href = blobUrl;
        a.download = `${options.title}.pdf`;
        a.click();
        URL.revokeObjectURL(blobUrl);
      },
      // readable stream stub implementation
      on: (event, action) => {},
      once: (...args) => {},
      emit: (...args) => {},
    });

    debugLog("after pdfdoc");

    let convert_progress = {
      title: document.title,
      from_page: options.from_page,
      cur_page: options.from_page - 1,
      to_page: options.to_page,
      page_count: pages,
      time_begin: new Date(),
    };
    // send message to background script
    browser.runtime.sendMessage({
      type: "start_converting",
      convert_progress,
    });

    // cancel the convertion progress
    let canceled = false;
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "cancel_convert") canceled = true;
    });

    window.onbeforeunload = (event) => {
      console.log("Attemmpt to leave to:")
      console.log(window.location)
      console.log(event)
      browser.runtime.sendMessage({
        type: "stop_converting",
      });
      pdf_doc.end();
    };

    for (let i = options.from_page; i <= options.to_page; i++) {
      if (canceled) break;
      console.log("downloading page " + i);
      try {
        await download_svg(i);
      } catch (error) {
        //if (error.cancel) canceled = true;
        if (error.msg) alert(error.msg);
        console.error(error);
      }
      console.log("downloaded page " + i);
      if(options.slowmode) await Sleep(1000);
      convert_progress.cur_page = i;
      browser.runtime.sendMessage({
        type: "update_progress",
        convert_progress,
      });
    }
    pdf_doc.end();
    browser.runtime.sendMessage({
      type: "stop_converting",
    });

    window.onbeforeunload = undefined;
    console.log("done");

    function download_svg(page) {
      return new Promise((resolve, reject) => {
        generatePageUrl(page).then((page_url) => {
          if (page_url === ``) {
            reject({
              msg: "Die Seite " + page + " wurde nicht gefunden. Es kann sein, dass die URL anders ist, als erwartet.",
            });
          }

          debugLog("page .svg at :" + `${page_url}${page}.svg`);
          http.open("GET", `${page_url}${page}.svg`);
          http.onreadystatechange = () => {
            // cancel callback if request hasnt finished
            if (http.readyState !== XMLHttpRequest.DONE) return;
            debugLog("in http");
            let parser = new DOMParser();

            let updated_response = http.responseText;
            let xml_doc = parser.parseFromString(updated_response, "text/xml");
            let uri_image_promises = [];
            debugLog("before xmldoc");

            recursiveAllChildImagesToURI(xml_doc, uri_image_promises, 0);
            debugLog("uri_image_promises:");
            debugLog(uri_image_promises);
            function recursiveAllChildImagesToURI(xml_doc, uri_image_promises, deph) {
              if (deph > 4) return;
              for (let child of xml_doc.children) {
                if (child.localName === "image") {
                  let href = child.attributes["xlink:href"].textContent;
                  debugLog("href");
                  uri_image_promises.push(to_data_uri(`${page_url}${href}`));
                }
                recursiveAllChildImagesToURI(child, uri_image_promises, deph + 1);
              }
            }

            debugLog("before promises");
            Promise.all(uri_image_promises).then((uris) => {
              debugLog(uris);
              for (let { uri, url } of uris) {
                updated_response = updated_response.replace(url.substring(`${page_url}`.length), uri);
                // substring in order to get the original path from the svg
              }
              debugLog(updated_response);
              let xml_doc = parser.parseFromString(updated_response, "text/xml");
              let svg_html = xml_doc.rootElement.outerHTML;
              debugLog("adding new page to pdf")
              pdf_doc.addPage();

              let add_page;
              if (options.savemethod === "vector") add_page = add_as_vector;
              else if (options.savemethod === "png") add_page = add_as_png;
              
              if (options.safemode) {
                // tests if the conversion works with a dummy pdf. In some cases an error in the conversion breaks the whole pdf ==> no output
                convertSafe()
              }
              else {
                convertFast()
              }
              function convertSafe()
              {
                console.log("testing if page " + page + " is convertable as " + options.savemethod);
                let dummyDoc = new PDFDocument({
                  autoFirstPage: true,
                  size: [width * options.scale, height * options.scale],
                  margin: 0,
                });
                add_page(dummyDoc, svg_html) // test conversion with dummy pdf (slow)
                  .then(() => {
                    // if succesfull convert with the real pdf
                    console.log("is convertable");
                    add_page(pdf_doc, svg_html)
                      .then(() => {
                        resolve(page);
                        debugLog(pdf_doc);
                      })
                      .catch((error) => reject({ cancel: true, msg: error.msg, error }));
                  })
                  .catch((error) => {
                    // if not succesfull, convert with the real pdf but other method
                    console.log(`Could not save page ${page}' as ${options.savemethod}. Trying other format \n Reason: ${error.msg}`);
                    if (options.savemethod === "vector") add_page = add_as_png; //tries the other method
                    else if (options.savemethod === "png") add_page = add_as_vector; // -"-
                    add_page(pdf_doc, svg_html)
                      .then(() => {
                        resolve(page);
                        debugLog(pdf_doc);
                      })
                      .catch((error) => reject({ cancel: true, msg: error.msg, error }));
                  });
              }

              function convertFast()
              {
                debugLog("before add svg");
                add_page(pdf_doc, svg_html)
                  .then(() => {
                    resolve(page);
                    debugLog(pdf_doc);
                  })
                  .catch((error) => {
                    console.log(
                      "Could not save page " + page +" as " + options.savemethod + ". Trying other format"+
                      "\n Reason: " + error.msg
                    );
                    if (options.savemethod === "vector") add_page = add_as_png; //tries the other option
                    else if (options.savemethod === "png") add_page = add_as_vector; // -"-
                    debugLog(pdf_doc);
                    // content in the page is overwritten
                    add_page(pdf_doc, svg_html)
                      .then(() => {
                        resolve(page);
                        debugLog(pdf_doc);
                      })
                      .catch((error) => reject({ cancel: true, msg: error.msg, error }));
                  });
              }
            });
          };
          http.send();
        });
      });

      function add_as_vector(doc, svg) {
        return new Promise((resolve, reject) => {
          debugLog("before pdfkit add image", { width, height });
          try {
            SVGtoPDF(doc, svg, 0, 0, { assumePt: true });
          } catch (error) {
            reject({
              msg:
                'Anscheinend funktioniert die Speichermethode "Vektor" bei diesem Buch ' +
                "nicht, bitte versuche es erneut und wähle eine andere aus." +
                `(Error code: ${error})`,
            });
            return;
          }
          debugLog("after pdfkit add image");
          resolve();
        });
      }

      function add_as_png(doc, svg) {
        return new Promise((resolve, reject) => {
          debugLog(svgAsPngUri);
          let template = document.createElement("div");
          template.innerHTML = svg;
          let svg_elem = template.childNodes[0];
          svg_elem.style.background_color = "white";
          debugLog(svg_elem);
          svgAsPngUri(svg_elem, { scale: options.scale }, (uri, w, h) => {
            debugLog("before pdfkit add image", doc.image);
            debugLog(uri);
            debugLog(options);
            // reject "data:," uris, as an error occurred while converting!
            if (uri === "data:,") {
              reject({
                msg:
                  'Anscheinend funktioniert die Speichermethode "PNG" bei diesem Buch ' +
                  "nicht, bitte versuche es erneut und wähle eine andere aus.",
              });
              return;
            }
            doc.image(uri, 0, 0);

            debugLog("after pdfkit add image");
            resolve();
          });
        });
      }
    }

    async function generatePageUrl(page) {
      // returns the URL of the Folder with all images + the .svg file // Should be read out of the E-Book site
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.onreadystatechange = () => {
          // cancel callback if request hasnt finished
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          if (xhr.status == 200) {
            //Page exist and loaded normal
            resolve(`${bookURL}${page}/`);
          }
        };

        xhr.open("GET", `${bookURL}${page}/${page}.svg`); //Try to load normal (old) link structure
        xhr.send();

        const xhr2 = new XMLHttpRequest();

        xhr2.onreadystatechange = () => {
          // cancel callback if request hasnt finished
          if (xhr2.readyState !== XMLHttpRequest.DONE) return;
          if (xhr2.status == 200) {
            //Page exist and loaded normal
            resolve(`${bookURL}`);
          }
        };
        xhr2.open("GET", `${bookURL}${page}.svg`); //Try to load alternative link structure
        xhr2.send();
      });
    }

    // used to parse images in svgs to pure data uris
    function to_data_uri(url) {
      return new Promise((resolve, reject) => {
        let http = new XMLHttpRequest();
        http.onload = function () {
          let reader = new FileReader();
          reader.onloadend = function () {
            resolve({
              uri: reader.result,
              url,
            });
          };
          reader.readAsDataURL(http.response);
        };
        http.open("GET", url);
        http.responseType = "blob";
        http.send();
      });
    }
  }
})();

function debugLog(obj){
  if (debugging)
    console.log(obj);
}

function Sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
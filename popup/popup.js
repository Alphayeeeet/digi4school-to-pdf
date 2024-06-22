let btn = document.getElementById("convert-btn");
let progress_bar = document.getElementsByClassName("progress")[0];
let progress = document.getElementsByClassName("determinate")[0];
let tabid;
let instance_modal;
const debugging = false;
let pages;
let div_modal;
progress_bar.style.display = "none";

// check if current page is a valid book page
const disable_popup = () => {
    document.getElementById("cur-book").innerText = 'Buch nicht geöffnet';
    btn.classList.add("disabled");
}

browser.tabs.query({currentWindow: true, active: true})
.then(tabs => {
    if (!tabs[0].url.match(/https:\/\/.*\/ebook\/.*/))
        disable_popup();
    else
        return browser.tabs.sendMessage(tabid = tabs[0].id, {type: "valid"})
})
.then(response => {
    if (response && response.injected)
        document.getElementById("cur-book").innerText = response.title;
    else disable_popup();
})
.catch(e => {
    error(e);
    disable_popup();
});

btn.onclick = () => {
    chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/libraries/browser-polyfill.min.js"]})
    .then(() => chrome.scripting.insertCSS({target: {tabId: tabid}, files: ["/libraries/materialize/materialize.min.css"]}))
    .then(() => chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/libraries/materialize/materialize.min.js"]}))
    .then(() => chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/libraries/pdfkit.standalone.js"]}))
    .then(() => chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/libraries/svg-to-pdfkit.min.js"]}))
    .then(() => chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/libraries/saveSvgAsPng.js"]}))
    .then(() => chrome.scripting.executeScript({target: {tabId: tabid}, files: ["/scripts/inject.js"]}))
    .then(() => {
        browser.runtime.sendMessage({type: "update_tabid", tabid})
        log("inserted all scripts");
        initModal();
    });
}

let ui_cur_page = document.getElementById("cur-page");
let ui_num_pages = document.getElementById("num-pages");
let ui_timer = document.getElementById("timer");

browser.runtime.sendMessage({type: "is_converting"})
.then(msg => {
    console.log(msg)
    if (msg.converting) {
        document.getElementById("cur-book-text").style.display = "none";
        document.getElementById("converting-text").style.display = null;
        document.getElementById("convert-details").style.display = null;
        progress_bar.style.display = null;
        btn.innerText = "Abbrechen";

        setInterval(() => {
            browser.runtime.sendMessage({type: "get_progress"})
            .then(msg => {
                let {cur_page, from_page, to_page, time_begin} = msg.convert_progress;
                document.getElementById("cur-converting").innerText = msg.convert_progress.title;
                // console.log(`${from_page} ${cur_page} ${to_page}`);
                // console.log(msg.convert_progress);
                ui_cur_page.innerText = cur_page - from_page + 1;
                ui_num_pages.innerText = to_page - from_page + 1;
                if (typeof time_begin !== Date) time_begin = Date.parse(time_begin);
                let time = Math.round((new Date() - time_begin) / 1000)
                console.log(time)
                let remaining_time = Math.round(time / (cur_page - from_page + 1) * (to_page - cur_page));
                let hours = Math.floor(remaining_time / 3600);
                remaining_time -= hours * 3600;
                let minutes = Math.floor(remaining_time / 60);
                let seconds = remaining_time % 60;
                if (hours !== Infinity)
                    ui_timer.innerText = `${hours}h ${minutes}m ${seconds}s`;
                else
                    ui_timer.innerText = `Nicht berechenbar`;
                progress.style.width = (100 * (cur_page - from_page + 1) / (to_page - from_page)) + "%";
                console.log(progress.style.width, msg.convert_progress)
            });

        }, 250);

        btn.onclick = () => {
            browser.tabs.sendMessage(msg.converting_tab, {type: "cancel_convert"})
            .then(window.close);
        }
    } else {
        document.getElementById("cur-book-text").style.display = null;
        document.getElementById("converting-text").style.display = "none";
        progress_bar.style.display = "none";
        btn.innerText = "Konvertieren";
    }
})

function initModal() {
    debugLog("Initiating")
    let d4s2pdf_modal = /* html */ 
   `<div class="modal-content">
      <div class="header">
        <img src="https://cdn.digi4school.at/img/d4s_logo.png">
        <span>&nbsp;to PDF</span>
      </div>
      <div class="content row">
      <div class="input-field col s12">
        <select id="savemethod">
          <option value="png">Als PNG (Rasterisiert)</option>
          <option value="vector" selected>Vektorgrafik (Hochauflösend)</option>
        </select>
        <label>Speichermethode</label>
      </div>
      <div class="col s1"></div>
      <div id="png-info" class="col s11" style="display: none">
        <p class="range-field">
          <label>Skalierung: <span id="scale-display">0.75</span>x</label>
          <input type="range" id="scale" min="1" max="16" value="4"/>
        </p>
        <p>Achtung: Je höher die Auflösung ist, desto länger braucht der Vorgang und die Ergebnis-PDF verbraucht mehr Speicherplatz.
    </p>
      </div>
      <p class="col s11" id="vector-info">Achtung: Manche Bilder können nicht gespeichert werden.</p>
      <div class="row">
        <div class="input-field col s6">
          <input id="from-page" type="text">
          <label for="from-page">Ab Seite</label>
        </div>
        <div class="input-field col s6">
          <input id="to-page" type="text">
          <label for="to-page">Bis Seite</label>
        </div>
      </div>
      <span style="display: none" id="page-error" class="d4s2pdf-error">Ungültiger Seitenbereich</span>
      <form action="#">
        <p>
          <label>
            <input id="safe-mode" type="checkbox" />
            <span title="Halbe Geschwindigkeit, falls das PDF nicht erscheint">Sicherer Modus</span>
          </label>
        </p>
        <p>
          <label>
            <input id="slow-mode" type="checkbox" />
            <span title="Drosselt die Geschwindigkeit auf 1 Seite pro Sekunde">Langsam Modus</span>
          </label>
        </p>
      </form>
    </div>
    </div>
      <div class="modal-footer">
      <button id="button-close" class="modal-close waves-effect waves-green btn">Abbrechen</button>&nbsp;&nbsp;
      <button id="button-convert-custom" class="waves-effect waves-green btn btn-d4s2pdf">Konvertieren</button>
    </div>`;

  div_modal = document.createElement("div");
  div_modal.id = "modal";
  div_modal.classList.add("modal");

  div_modal.innerHTML = d4s2pdf_modal;

  document.body.prepend(div_modal);

  M.Modal.init(document.querySelectorAll(".modal"));
  M.FormSelect.init(document.querySelectorAll("#savemethod"));

  instance_modal = M.Modal.getInstance(div_modal);
  instance_modal.open();

  let vector_info = document.getElementById("vector-info");
  let png_info = document.getElementById("png-info");
  let safemode = document.getElementById("safe-mode");
  let slowmode = document.getElementById("safe-mode");

  // interface listeners
  let savemethod = document.getElementById("savemethod");
  savemethod.onchange = () => {
    if (savemethod.value === "png") {
      png_info.style.display = null;
      vector_info.style.display = "none";
    } else {
      vector_info.style.display = null;
      png_info.style.display = "none";
    }
  };

  let scale_display = document.getElementById("scale-display");
  let scale = document.getElementById("scale");

  scale.oninput = () => {
    scale_display.innerText = Number(scale.value) * 0.25;
  };

  let btn_convert = document.getElementById("button-convert-custom");

  let from_page = document.getElementById("from-page");
  let to_page = document.getElementById("to-page");
  let page_error = document.getElementById("page-error");

  from_page.max = pages;
  to_page.max = pages;

  let check_page_error = () => {
    if (
      from_page.value.match(/^[\d]*$/) === null ||
      to_page.value.match(/^[\d]*$/) === null ||
      (Number(to_page.value) >= 1 && Number(from_page.value) > Number(to_page.value)) ||
      Number(from_page.value) > pages ||
      Number(to_page.value) > pages
    ) {
      page_error.style.display = null;
      btn_convert.classList.add("disabled");
    } else {
      page_error.style.display = "none";
      btn_convert.classList.remove("disabled");
    }
  };

  btn_convert.onclick = () => {
    const message = {
        type: "init_convert",
        options: {
            savemethod: savemethod.value,
            from_page: from_page.value,
            to_page: to_page.value,
            scale: scale.value,
            safemode: safemode.checked,
            slowmode: slowmode.checked
        }
    }

    browser.tabs.sendMessage(tabid, message);
    log("Initiated conversion start")
    window.close()
  }


  from_page.oninput = check_page_error;
  to_page.oninput = check_page_error;

  document.getElementById("button-close").onclick = remove_custom_css;
}

let remove_custom_css = () => {
    document.body.removeChild(div_modal);
};

browser.runtime.onMessage.addListener(onMessage);

function onMessage(message) {
    if(message.type === "close_option_modal") {
        instance_modal.close();
        remove_custom_css();
    } else if(message.type === "update_pages_count") {
        pages = message.pages;
    }
}

function debugLog(obj){
if (debugging) log(obj);
}

function log(message) {
    browser.tabs.sendMessage(tabid, {type: "log", message: JSON.stringify(message)});
}

function error(message) {
    browser.tabs.sendMessage(tabid, {type: "error", message: JSON.stringify(message)});
}
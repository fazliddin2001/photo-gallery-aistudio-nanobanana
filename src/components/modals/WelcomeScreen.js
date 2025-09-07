import React, { Component } from "react";
import { connect } from "react-redux";
import { NativeTypes } from "react-dnd-html5-backend";
import { DropTarget } from "react-dnd";
import Spinner from "react-bootstrap/Spinner";

import "./welcomeScreen.css";
import DEFAULT_IMAGE_URL from "../constants/constants";

const EXAMPLE_PHOTO = {
    name: "9392366.jpg",
    url: DEFAULT_IMAGE_URL
};

const nativeFileTarget = {
    hover(props, monitor, component) {
        // keep behavior similar to original (shallow hover check)
        monitor.isOver({ shallow: true });
    },
    drop(props, monitor, component) {
        component.handleDroppedFiles(monitor);
    }
};

function collect(connect, monitor) {
    return {
        connectDropTarget: connect.dropTarget(),
        isOverCurrent: monitor.isOver({ shallow: false }),
        itemType: monitor.getItemType(),
        didDrop: monitor.didDrop(),
        isOver: monitor.isOver()
    };
}

class WelcomeScreen extends Component {
    constructor(props) {
        super(props);
        this.state = {
            showSpinner: false
        };
    }

    componentDidMount() {
    console.log("[WelcomeScreen] mounted");
    console.log("location.href:", window.location.href);
    console.log("location.search:", window.location.search);
    console.log("location.hash:", window.location.hash);

    // Try to read query param even if it's inside the hash (HashRouter)
    const foundUrl = this.getUrlFromDomOrQuery(true);

    if (foundUrl) {
        console.log("[WelcomeScreen] found image from query/hash:", foundUrl);
        const name = this.extractFileName(foundUrl);
        const imageObj = { url: foundUrl, name };
        try { localStorage.setItem("image", JSON.stringify(imageObj)); } catch(e){/* ignore */ }
        this.props.setImage(foundUrl, name);
        return;
    }

    // Otherwise fall back to localStorage (if present), else default
    try {
        const ls = JSON.parse(localStorage.getItem("image"));
        if (ls && ls.url) {
            console.log("[WelcomeScreen] using image from localStorage:", ls.url);
            this.props.setImage(ls.url, ls.name || "image");
            return;
        }
    } catch (e) { /* ignore */ }

    console.log("[WelcomeScreen] no stored image or query; using example photo");
    const defaultObj = { url: EXAMPLE_PHOTO.url, name: EXAMPLE_PHOTO.name };
    try { localStorage.setItem("image", JSON.stringify(defaultObj)); } catch(e){/* */ }
    this.props.setImage(defaultObj.url, defaultObj.name);
}

// robust detector: optionally look inside hash for ?image=...
getUrlFromDomOrQuery(checkHash = false) {
    // 1) Try normal search
    try {
        const params = new URLSearchParams(window.location.search);
        const q = params.get("image");
        if (q) return q;
    } catch (e) { /* ignore */ }

    // 2) If requested, parse query inside hash (for HashRouter)
    if (checkHash) {
        try {
            const hash = window.location.hash || "";
            // common forms:
            //  #/?image=http://...
            //  #/some/path?image=http://...
            const hashIndex = hash.indexOf("?");
            if (hashIndex !== -1) {
                const hashQuery = hash.substring(hashIndex);
                const params = new URLSearchParams(hashQuery);
                const q = params.get("image");
                if (q) return q;
            }
        } catch (e) { /* ignore */ }
    }

    // 3) DOM fallbacks (id / class / data attribute / anchor text)
    try {
        const elById = document.getElementById("image-url");
        if (elById) {
            if (elById.tagName === "A" && elById.href) return elById.href;
            if ("value" in elById && elById.value) return elById.value;
            const attr = elById.getAttribute && elById.getAttribute("data-image-url");
            if (attr) return attr;
        }

        const elClass = document.querySelector(".image-url");
        if (elClass) {
            if (elClass.tagName === "A" && elClass.href) return elClass.href;
            if ("value" in elClass && elClass.value) return elClass.value;
            const attr = elClass.getAttribute && elClass.getAttribute("data-image-url");
            if (attr) return attr;
        }

        const dataEl = document.querySelector("[data-image-url]");
        if (dataEl) {
            const val = dataEl.getAttribute("data-image-url");
            if (val) return val;
        }

        const anchors = Array.from(document.querySelectorAll("a"));
        for (const a of anchors) {
            if (a.textContent && a.textContent.trim().toLowerCase() === "url" && a.href) {
                return a.href;
            }
        }
    } catch (e) { /* ignore */ }

    return null;
}


    // tries several heuristics to find an image URL:
    //  - ?image=<url>
    //  - element with id="image-url" (href or value)
    //  - element with class .image-url (href/value/data-image-url)
    //  - element with attribute data-image-url
    //  - anchor whose visible text is "URL"
    getUrlFromDomOrQuery() {
        // 1) query param ?image=...
        try {
            const params = new URLSearchParams(window.location.search);
            const q = params.get("image");
            if (q) return q;
        } catch (e) {
            // ignore
        }

        // 2) element with id="image-url"
        const elById = document.getElementById("image-url");
        if (elById) {
            if (elById.tagName === "A" && elById.href) return elById.href;
            if ("value" in elById && elById.value) return elById.value;
            const attr = elById.getAttribute && elById.getAttribute("data-image-url");
            if (attr) return attr;
        }

        // 3) element with class .image-url (first)
        const elClass = document.querySelector(".image-url");
        if (elClass) {
            if (elClass.tagName === "A" && elClass.href) return elClass.href;
            if ("value" in elClass && elClass.value) return elClass.value;
            const attr = elClass.getAttribute && elClass.getAttribute("data-image-url");
            if (attr) return attr;
        }

        // 4) any element with data-image-url attribute
        const dataEl = document.querySelector("[data-image-url]");
        if (dataEl) {
            const val = dataEl.getAttribute("data-image-url");
            if (val) return val;
        }

        // 5) anchor with visible text "URL" (case-insensitive)
        const anchors = Array.from(document.querySelectorAll("a"));
        for (const a of anchors) {
            if (a.textContent && a.textContent.trim().toLowerCase() === "url" && a.href) {
                return a.href;
            }
        }

        return null;
    }

    extractFileName(url) {
        try {
            const u = new URL(url, window.location.href);
            const path = u.pathname || "";
            let name = path.substring(path.lastIndexOf("/") + 1) || u.hostname;
            name = name.split("?")[0] || "image";
            return name;
        } catch (e) {
            // fallback (data: URL or malformed)
            const parts = url.split("/");
            return (parts[parts.length - 1] || "image").split("?")[0];
        }
    }

    handleDroppedFiles(monitor) {
        const item = monitor.getItem && monitor.getItem();
        if (!item) return;
        // item.files is typically a FileList
        const files = item.files;
        if (!files || !files.length) return;

        console.log("monitor.getItem().files: ", files);
        this.setState({ showSpinner: true }, () => {
            // reuse the onImageChange flow which reads file and dispatches HANDLE_FILE_UPLOAD
            this.onImageChange({ target: { files } });
        });
    }

    onImageChange(event) {
        if (event && event.target && event.target.files && event.target.files[0]) {
            let reader = new FileReader();
            let file = event.target.files[0];
            reader.fileName = file.name;

            reader.onloadend = upload => {
                // upload.target.result holds the dataURL; original code dispatched upload.target
                // keep the same behavior so reducer/epics expecting upload.target still work
                this.props.handleUploadedFile(upload.target);

                // also store a "previously edited" entry in localStorage so UI shows it
                try {
                    const imgObj = { url: upload.target.result, name: file.name };
                    localStorage.setItem("image", JSON.stringify(imgObj));
                    // Also dispatch setImage so Redux image state is in sync
                    this.props.setImage(imgObj.url, imgObj.name);
                } catch (e) {
                    // ignore quota issues
                }

                this.setState({ showSpinner: false });
            };
            reader.readAsDataURL(file);
        }
    }

    handleCrossClick = e => {
        e.stopPropagation();
        // remove only our image entry
        localStorage.removeItem("image");
        // Optionally reset redux store image (commented out — enable if desired)
        // this.props.setImage(EXAMPLE_PHOTO.url, EXAMPLE_PHOTO.name);
        this.forceUpdate();
    };

    render() {
        const { connectDropTarget, isOver } = this.props;

        let localStorageImage = null;
        try {
            localStorageImage = JSON.parse(localStorage.getItem("image"));
        } catch (e) {
            // ignore parse errors
            localStorageImage = null;
        }

        return (
            <div style={{ height: "100%" }}>
                <div className="wrapper">
                    <div className="upper-wrapper">
                        <div className="panel-left">
                            <div className="content">
                                <div className="content-image-wrapper">
                                    <div className="contentHeader">Example Photo</div>
                                    <img
                                        src={EXAMPLE_PHOTO.url}
                                        style={{
                                            height: "80%",
                                            width: "75%",
                                            borderRadius: 7,
                                            objectFit: "cover"
                                        }}
                                        alt="Example Img"
                                        onClick={() =>
                                            this.props.setImage(
                                                EXAMPLE_PHOTO.url,
                                                EXAMPLE_PHOTO.name
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        {localStorageImage ? (
                            <div className="panel-right">
                                <div className="header-for-right-panel">
                                    Previously Edited Images
                                </div>
                                <div className="row-flex-wrapper">
                                    <div className="image-wrapper">
                                        <div
                                            className="image-box"
                                            onClick={() =>
                                                this.props.setImage(
                                                    localStorageImage.url,
                                                    localStorageImage.name
                                                )
                                            }
                                            style={{
                                                backgroundImage: `url(${localStorageImage.url})`
                                            }}
                                        >
                                            <i
                                                className="fas fa-times"
                                                onClick={this.handleCrossClick}
                                            />
                                        </div>
                                        <div className="image-desc">
                                            {localStorageImage.name}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="panel-right">
                                <div className="header-for-right-panel">
                                    Previously Edited Images
                                </div>
                                <div className="row-flex-wrapper">
                                    <div className="image-wrapper">
                                        <div
                                            className="image-box"
                                            style={{ cursor: "auto" }}
                                        />
                                        <div className="image-desc">Such an empty list!</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="lower-wrapper">
                        <div className="lower-left-panel">{/* HELlo */}</div>

                        {connectDropTarget(
                            <div
                                className="drag-drop-panel"
                                onClick={e => this.fileInput && this.fileInput.click()}
                            >
                                {this.state.showSpinner ? (
                                    <Spinner animation="grow" variant="danger" />
                                ) : isOver ? (
                                    <h2>Release to Upload!</h2>
                                ) : (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column"
                                        }}
                                    >
                                        <h3>Drag and Drop to Upload</h3>
                                        <span style={{ fontSize: 17 }}>Or Click Here</span>
                                    </div>
                                )}
                            </div>
                        )}
                        <input
                            type="file"
                            style={{ display: "none" }}
                            onChange={e => this.onImageChange(e)}
                            ref={fileInput => (this.fileInput = fileInput)}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispachToProps = dispatch => {
    return {
        handleUploadedFile: file => {
            dispatch({ type: "HANDLE_FILE_UPLOAD", payload: file });
        },
        setImage: (image, name) => {
            dispatch({
                type: "SET_IMAGE_FROM_WELCOME_SCREEN",
                payload: { result: image, fileName: name }
            });
        }
    };
};

const mapStateToProps = state => {
    return { image: state.image };
};

export default connect(
    mapStateToProps,
    mapDispachToProps
)(DropTarget(NativeTypes.FILE, nativeFileTarget, collect)(WelcomeScreen));

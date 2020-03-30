// Includes;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const AggregateMenu = Main.panel.statusArea.aggregateMenu;

let vpnStatusIndicator;

const customGroups = [
    {
        name: "P2P",
        label: "P2P"
    },
    {
        name: "Double_VPN",
        label: "Double VPN"
    },
    {
        name: "Dedicated_IP",
        label: "Dedicated IP"
    },
    {
        name: "Onion_Over_VPN",
        label: "Onion"
    }
];

class NordVPN {
    constructor () {
        this._commands = {
            connect: "nordvpn c",
            disconnect: "nordvpn d",
            status: "nordvpn status",
            groups: "nordvpn groups"
        };

        this._states = {
            CONNECTED: "CONNECTED"
        };

        this.groups = [];

        this.group = "";
    }

    /**
     * Call NordVPN Command Line Tool to connect to the VPN Service
     *
     * @param {String} group Group you want to connect to (e.g. nordvpn groups)
     * @returns {void}
     */
    connect (group = "") {
        this.group = group;
        GLib.spawn_command_line_async(`${this._commands.connect} ${group}`);
    }

    /**
     * Call NordVPN Command Line Tool to disconnect from the VPN Service
     *
     * @returns {void}
     */
    disconnect () {
        this.group = "";
        GLib.spawn_command_line_async(this._commands.disconnect);
    }

    /**
     * Call NordVPN Command Line Tool to filter custom groups with VPN groups
     *
     * @returns {void}
     */
    getGroups () {
        const data = (GLib.spawn_command_line_sync(this._commands.groups)[1]);
        let groups;
        if (data instanceof Uint8Array) {
            groups = imports.byteArray.toString(data).trim();
        } else {
            groups = data.toString().trim();
        }

        const available = groups.replace(/[\-\r,]+/g, " ").split(" ").filter(group => group);

        this.groups = customGroups.filter(group => available.indexOf(group.name) >= 0);
    }

    /**
     * Call NordVPN Command Line Tool to get the status of the VPN connection
     *
     * @returns {{connected: Boolean, country: String, city: String, fullStatus: String, serverNumber: Number, status: String}|{connected: Boolean, fullStatus: String, status: String}}
     */
    getStatus () {
        const data = (GLib.spawn_command_line_sync(this._commands.status)[1]);
        let fullStatus;
        if (data instanceof Uint8Array) {
            fullStatus = imports.byteArray.toString(data).trim();
        } else {
            fullStatus = data.toString().trim();
        }
        const result = fullStatus.split("\n");
        const statusLine = result.find((line) => line.includes("Status:"));
        const status = statusLine ? statusLine.replace("Status:", "").trim() : "Unknown";

        if (status.toUpperCase() === this._states.CONNECTED) {
            const serverNumberLine = result.find((line) => line.includes("server:"));
            const countryLine = result.find((line) => line.includes("Country:"));
            const cityLine = result.find((line) => line.includes("City:"));

            const serverNumber = serverNumberLine ? serverNumberLine.match(/\d+/) :  "Unknown";
            const country = countryLine ? countryLine.replace("Country:", "").trim() :  "Unknown";
            const city = cityLine ? cityLine.replace("City:", "").trim() :  "Unknown";

            const group = (customGroups.find(group => group.name === this.group) ? customGroups.find(group => group.name === this.group).name : "Standard");

            return {
                connected: true,
                group,
                status,
                serverNumber,
                country,
                city,
                fullStatus
            };
        } else {
            return {
                connected: false,
                group: "Standard",
                status: status,
                fullStatus
            };
        }
    }
}

class VPNStatusIndicator extends PanelMenu.SystemIndicator {
    constructor () {
        super();

        // Add the indicator to the indicator bar
        this._indicator = this._addIndicator();
        this._indicator.icon_name = "network-vpn-symbolic";
        this._indicator.visible = false;

        // Build a menu

        // Main item with the header section
        this._item = new PopupMenu.PopupSubMenuMenuItem("NordVPN", true);
        this._item.icon.icon_name = "network-vpn-symbolic";
        this._item.label.clutter_text.x_expand = true;
        this.menu.addMenuItem(this._item);

        // Content Inside the box
        this._item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._connectionGroup = new PopupMenu.PopupMenuItem("");
        this._item.menu.addMenuItem(this._connectionGroup);
        this._connectionDetails = new PopupMenu.PopupMenuItem("");
        this._item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._item.menu.addMenuItem(this._connectionDetails);

        // Initiate NordVPN handler
        this.vpnHandler = new NordVPN();

        // Add elements to the UI
        AggregateMenu._indicators.insert_child_at_index(this.indicators, 0);
        AggregateMenu.menu.addMenuItem(this.menu, 4);
    }

    enable () {
        this.vpnHandler.getGroups();
        this.resetTimer();
        this._refresh();
    }

    /**
     * Call NordVPN Command Line Tool to connect to the VPN Service
     *
     * @param {String} group Group to connect width
     * @private
     */
    _connect (group = "") {
        this.stopTimer();
        this.vpnHandler.connect(group);
        this.resetTimer();
        this.startTimer();
    }

    /**
     * Call NordVPN Command Line Tool to disconnect from the VPN Service
     *
     * @private
     */
    _disconnect () {
        this.stopTimer();
        this.vpnHandler.disconnect();
        this.resetTimer();
        this.startTimer();
    }

    /**
     * Call NordVPN Command Line Tool to get the current status of the connection
     *
     * @private
     */
    _refresh () {
        this.stopTimer();
        this._update(this.vpnHandler.getStatus());
        this.startTimer();
    }

    /**
     * Updates the widgets based on the vpn status
     *
     * @param {Object} vpnStatus
     * @private
     */
    _update (vpnStatus) {
        // Update the panel button
        this._indicator.visible = vpnStatus.connected;
        this._item.label.text = `NordVPN ${vpnStatus.status}`;

        if (vpnStatus.connected) {
            if (!this._disconnectAction)
                this._disconnectAction = this._item.menu.addAction("Disconnect", this._disconnect.bind(this));

            if (this._connectAction) {
                for (const i in this._connectAction) {
                    this._connectAction[i].destroy();
                }
                this._connectAction = null;
            }
        } else {
            if (!this._connectAction) {
                this._connectAction = [];
                this._connectAction.push(this._item.menu.addAction("Connect", this._connect.bind(this)));

                for (const group of this.vpnHandler.groups) {
                    this._connectAction.push(this._item.menu.addAction(`Connect to ${group.label}`, function () {
                        this._connect(group.name);
                    }.bind(this)));
                }
            }
            if (this._disconnectAction) {
                this._disconnectAction.destroy();
                this._disconnectAction = null;
            }

        }
        this._connectionGroup.label.text = vpnStatus.group;
        this._connectionDetails.label.text = vpnStatus.fullStatus;
    }

    resetTimer () {
        this._timerStep = 1;
    }

    startTimer () {
        this._timer = Mainloop.timeout_add_seconds(this._timerStep, Lang.bind(this, this._refresh));
        this._timerStep = this._timerStep * 2;
        this._timerStep = (this._timerStep > 30) ? 30 : this._timerStep;
    }

    stopTimer () {
        if (this._timer) {
            Mainloop.source_remove(this._timer);
            delete this._timer;
        }
    }

    destroy () {
        this.stopTimer();
        // Call destroy on the parent
        this.indicators.destroy();
        if (typeof this.parent === "function") {
            this.parent();
        }
    }
}

function init () { }

function enable () {
    // Init the indicator
    vpnStatusIndicator = new VPNStatusIndicator();
    vpnStatusIndicator.enable();
}

function disable () {
    // Remove the indicator from the panel
    vpnStatusIndicator.destroy();
    vpnStatusIndicator = null;
}

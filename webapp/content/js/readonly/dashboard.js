// Global object names
var viewport;
var contextSelector;
var contextSelectorFields = [];
var selectedScheme = null;
var metricSelector;
var metricSelectorMode;
var metricSelectorGrid;
var metricSelectorTextField;
var graphArea;
var graphStore;
var graphView;
var navBar;
var dashboardName;
var dashboardSlug;
var dashboardURL;
var refreshTask;
var spacer;
var justClosedGraph = false;
var NOT_EDITABLE = ['from', 'until', 'width', 'height', 'target', 'uniq', '_uniq'];
var editor = null;

var cookieProvider = new Ext.state.CookieProvider({
  path: "../dashboard"
});

var NAV_BAR_REGION = cookieProvider.get('navbar-region') || 'north';

var CONFIRM_REMOVE_ALL = cookieProvider.get('confirm-remove-all') != 'false';

/* Nav Bar configuration */
var navBarNorthConfig = {
  region: 'north',
  layout: 'hbox',
  layoutConfig: { align: 'stretch' },
  collapsible: true,
  collapseMode: 'mini',
  split: true,
  title: "untitled",
  height: 350,
  listeners: {
    expand: function() { focusCompleter(); } // defined below
  }
};

var navBarWestConfig = Ext.apply({}, navBarNorthConfig);
delete navBarWestConfig.height;
navBarWestConfig.region = 'west';
navBarWestConfig.layout = 'vbox';
navBarWestConfig.width = 338;


// Record types and stores
var SchemeRecord = Ext.data.Record.create([
  {name: 'name'},
  {name: 'pattern'},
  {name: 'fields', type: 'auto'}
]);

var schemeRecords = [];

var schemesStore = new Ext.data.Store({
  fields: SchemeRecord
});


var ContextFieldValueRecord = Ext.data.Record.create([
  {name: 'name'},
  {path: 'path'}
]);

var contextFieldStore = new Ext.data.JsonStore({
  url: '../metrics/find/',
  root: 'metrics',
  idProperty: 'name',
  fields: ContextFieldValueRecord,
  baseParams: {format: 'completer', wildcards: '1'}
});


var GraphRecord = new Ext.data.Record.create([
  {name: 'target'},
  {name: 'params', type: 'auto'},
  {name: 'url'},
  {name: 'width', type: 'auto'},
  {name: 'height', type: 'auto'}
]);

var graphStore;
function graphStoreUpdated() {
}

graphStore = new Ext.data.ArrayStore({
  fields: GraphRecord,
  listeners: {
    add: graphStoreUpdated,
    remove: graphStoreUpdated,
    update: graphStoreUpdated
  }
});

var originalDefaultGraphParams = {
  from: '-2hours',
  until: 'now',
  width: UI_CONFIG.default_graph_width,
  height: UI_CONFIG.default_graph_height
};
var defaultGraphParams;
//XXX
// Per-session default graph params
var sessionDefaultParamsJson = cookieProvider.get('defaultGraphParams');
if (sessionDefaultParamsJson && sessionDefaultParamsJson.length > 0) {
  defaultGraphParams = Ext.decode(sessionDefaultParamsJson);
} else {
  defaultGraphParams = Ext.apply({}, originalDefaultGraphParams);
}


function initDashboard () {

  // Populate naming-scheme based datastructures
  Ext.each(schemes, function (scheme_info) {
    scheme_info.id = scheme_info.name;
    schemeRecords.push( new SchemeRecord(scheme_info) );

    Ext.each(scheme_info.fields, function (field) {

      // Context Field configuration
      contextSelectorFields.push( new Ext.form.ComboBox({
        id: scheme_info.name + '-' + field.name,
        fieldLabel: field.label,
        width: CONTEXT_FIELD_WIDTH,
        mode: 'remote',
        triggerAction: 'all',
        editable: true,
        forceSelection: false,
        store: contextFieldStore,
        displayField: 'name',
        queryDelay: 100,
        queryParam: 'query',
        minChars: 1,
        typeAhead: false,
        value: queryString[field.name] || getContextFieldCookie(field.name) || "*",
        listeners: {
          beforequery: buildQuery,
          change: contextFieldChanged,
          select: function (thisField) { thisField.triggerBlur(); focusCompleter(); },
          afterrender: function (thisField) { thisField.hide(); },
          hide: function (thisField) { thisField.getEl().up('.x-form-item').setDisplayed(false); },
          show: function (thisField) { thisField.getEl().up('.x-form-item').setDisplayed(true); }
        }
      }) );

    });

  });
  schemesStore.add(schemeRecords);

  spacer = new Ext.form.TextField({
    hidden: true,
    hideMode: 'visibility'
  });

  var metricTypeCombo = new Ext.form.ComboBox({
    id: 'metric-type-field',
    fieldLabel: 'Metric Type',
    width: CONTEXT_FIELD_WIDTH,
    mode: 'local',
    triggerAction: 'all',
    editable: false,
    store: schemesStore,
    displayField: 'name',
    listeners: {
      afterrender: function (combo) {
        var value = (queryString.metricType) ? queryString.metricType : getContextFieldCookie('metric-type');

        if (!value) {
          value = "Everything";
        }
        var index = combo.store.find("name", value);
        if (index > -1) {
          var record = combo.store.getAt(index);
          combo.setValue(value);
          metricTypeSelected.defer(250, this, [combo, record, index]);
        }
      },
      select: metricTypeSelected
    }
  });

  contextSelector = new Ext.form.FormPanel({
    flex: 1,
    autoScroll: true,
    labelAlign: 'right',
    items: [
      spacer,
      metricTypeCombo
    ].concat(contextSelectorFields)
  });

  function expandNode(node, recurse) {
    function addAll () {
      Ext.each(node.childNodes, function (child) {
        if (child.leaf) {
          graphAreaToggle(child.id, {dontRemove: true});
        } else if (recurse) {
          expandNode(child, recurse);
        }
      });
    }

    if (node.isExpanded()) {
      addAll();
    } else {
      node.expand(false, false, addAll);
    }
  }

  var folderContextMenu = new Ext.menu.Menu({
    items: [{
      text: "Add All Metrics",
      handler: function (item, e) {
                 expandNode(item.parentMenu.node, false);
               }
    }, {
      text: "Add All Metrics (recursively)",
      handler: function (item, e) {
                 expandNode(item.parentMenu.node, true);
               }
    }]
  });

  if (NAV_BAR_REGION == 'west') {
    metricSelectorMode = 'tree';
    metricSelector = new Ext.tree.TreePanel({
      root: new Ext.tree.TreeNode({}),
      containerScroll: true,
      autoScroll: true,
      flex: 3.0,
      pathSeparator: '.',
      rootVisible: false,
      singleExpand: false,
      trackMouseOver: true,
      listeners: {
      click: metricTreeSelectorNodeClicked,
      contextmenu: function (node, e) {
                     if (!node.leaf) {
                       folderContextMenu.node = node;
                       folderContextMenu.showAt( e.getXY() );
                     }
                   }
      }
    });
  } else { // NAV_BAR_REGION == 'north'
    metricSelectorMode = 'text';
    metricSelectorGrid = new Ext.grid.GridPanel({
      region: 'center',
      hideHeaders: true,
      loadMask: true,
      bodyCssClass: 'metric-result',

      colModel: new Ext.grid.ColumnModel({
        defaults: {
          sortable: false,
          menuDisabled: true
        },
        columns: [
          {header: 'Metric Path', width: 1.0, dataIndex: 'path'}
        ]
      }),
      viewConfig: {
        forceFit: true,
        rowOverCls: '',
        bodyCssClass: 'metric-result',
        getRowClass: function(record, index) {
          var toggledClass = (
             graphStore.findExact('target', 'target=' + record.data.path) == -1
            ) ? "metric-not-toggled" : "metric-toggled";
          var branchClass = (
            record.data['is_leaf'] == '0'
          ) ? "result-is-branch-node" : "";
          return toggledClass + ' ' + branchClass + ' metric-result';
        }
      },
      selModel: new Ext.grid.RowSelectionModel({
        singleSelect: false
      }),
      store: new Ext.data.JsonStore({
        method: 'GET',
        url: '../metrics/find/',
        autoLoad: true,
        baseParams: {
          query: '',
          format: 'completer',
          automatic_variants: (UI_CONFIG.automatic_variants) ? '1' : '0'
        },
        fields: ['path', 'is_leaf'],
        root: 'metrics'
      }),
      listeners: {
        rowclick: function (thisGrid, rowIndex, e) {
                    var record = thisGrid.getStore().getAt(rowIndex);
                    if (record.data['is_leaf'] == '1') {
                      graphAreaToggle(record.data.path);
                      thisGrid.getView().refresh();
                    } else {
                      metricSelectorTextField.setValue(record.data.path);
                    }
                    autocompleteTask.delay(50);
                    focusCompleter();
                  }
      }
    });

    function completerKeyPress(thisField, e) {
      var charCode = e.getCharCode();
      if (charCode == 8 ||  //backspace
          charCode >= 46 || //delete and all printables
          charCode == 36 || //home
          charCode == 35) { //end
        autocompleteTask.delay(AUTOCOMPLETE_DELAY);
      }
    }

    metricSelectorTextField = new Ext.form.TextField({
      region: 'south',
      enableKeyEvents: true,
      cls: 'completer-input-field',
      listeners: {
        keypress: completerKeyPress,
        specialkey: completerKeyPress,
        afterrender: focusCompleter
      }
    });
    metricSelector = new Ext.Panel({
      flex: 1.5,
      layout: 'border',
      items: [metricSelectorGrid, metricSelectorTextField]
    });
  }

  var autocompleteTask = new Ext.util.DelayedTask(function () {
    var query = metricSelectorTextField.getValue();
    var store = metricSelectorGrid.getStore();
    store.setBaseParam('query', query);
    store.load();
  });

  var graphTemplate = new Ext.XTemplate(
    '<tpl for=".">',
      '<div class="graph-container">',
        '<div class="graph-overlay">',
          '<img class="graph-img" src="{url}" width="{width}" height="{height}">',
          '<div class="overlay-close-button" onclick="javascript: graphStore.removeAt(\'{index}\'); updateGraphRecords(); justClosedGraph = true;">X</div>',
        '</div>',
      '</div>',
    '</tpl>',
    '<div class="x-clear"></div>'
  );

  graphView = new Ext.DataView({
    store: graphStore,
    tpl: graphTemplate,
    itemSelector: 'div.graph-container',
    emptyText: "Configure your context above, and then select some metrics.",
    autoScroll: true,
    listeners: {
    }
  });

  /* Toolbar items */
  var relativeTimeRange = {
          icon: CLOCK_ICON,
          text: "Relative Time Range",
          tooltip: 'View Recent Data',
          handler: selectRelativeTime,
          scope: this
  };

  var absoluteTimeRange = {
    icon: CALENDAR_ICON,
    text: "Absolute Time Range",
    tooltip: 'View Specific Time Range',
    handler: selectAbsoluteTime,
    scope: this
  };

  var timeRangeText = {
    id: 'time-range-text',
    xtype: 'tbtext',
    text: getTimeText()
  };

  var dashboardMenu = {
    text: 'Dashboard (Read-Only)',
    menu: {
      items: [
        {
          text: "Finder",
          handler: showDashboardFinder
        },
        {
          text: "Configure UI",
          handler: configureUI
        }
      ]
    }
  };

  var graphsMenu = {
    text: 'Graphs',
    menu: {
      items: [
        {
          text: "Resize",
          handler: selectGraphSize
        }
      ]
    }
  };

  var resizeButton = {
    icon: RESIZE_ICON,
    tooltip: "Resize Graphs",
    handler: selectGraphSize
  };

  var refreshButton = {
    icon: REFRESH_ICON,
    tooltip: 'Refresh Graphs',
    handler: refreshGraphs
  };

  var autoRefreshButton = {
    xtype: 'button',
    id: 'auto-refresh-button',
    text: "Auto-Refresh",
    enableToggle: true,
    pressed: true,
    tooltip: "Toggle auto-refresh",
    toggleHandler: function (button, pressed) {
                     if (pressed) {
                       startTask(refreshTask);
                     } else {
                       stopTask(refreshTask);
                     }
                   }
  };



  var every = {
    xtype: 'tbtext',
    text: 'every'
  };

  var seconds = {
    xtype: 'tbtext',
    text: 'seconds'
  };

  var autoRefreshField = {
    id: 'auto-refresh-field',
    xtype: 'textfield',
    width: 25,
    value: UI_CONFIG.refresh_interval,
    enableKeyEvents: true,
    disableKeyFilter: true,
    listeners: {
      change: function (field, newValue) { updateAutoRefresh(newValue); },
      specialkey: function (field, e) {
                    if (e.getKey() == e.ENTER) {
                      updateAutoRefresh( field.getValue() );
                    }
                  }
    }
  };

  var lastRefreshed = {
    xtype: 'tbtext',
    text: 'Last Refreshed: '
  };

  var lastRefreshedText = {
    id: 'last-refreshed-text',
    xtype: 'tbtext',
    text: ( new Date() ).format('g:i:s A')
  };

  graphArea = new Ext.Panel({
    region: 'center',
    layout: 'fit',
    autoScroll: false,
    bodyCssClass: 'graph-area-body',
    items: [graphView],
    tbar: new Ext.Toolbar({
      items: [
        dashboardMenu,
        graphsMenu,
        //'-',
        //shareButton,
        '-',
        relativeTimeRange,
        absoluteTimeRange,
        '-',
        timeRangeText,
        '->',
        //helpButton,
        resizeButton,
        refreshButton,
        autoRefreshButton,
        every, autoRefreshField, seconds,
        '-',
        lastRefreshed, lastRefreshedText
      ]
    })
  });

  /* Nav Bar */
  //navBarNorthConfig.items = [metricSelector];
  //navBarWestConfig.items = [contextSelector, metricSelector];
  var navBarConfig = (NAV_BAR_REGION == 'north') ? navBarNorthConfig : navBarWestConfig;
  //navBar = new Ext.Panel(navBarConfig);
  navBar = {};

  viewport = new Ext.Viewport({
    layout: 'border',
    items: [
      navBar,
      graphArea
    ]
  });

  refreshTask = {
    run: refreshGraphs,
    interval: UI_CONFIG.refresh_interval * 1000
  };

  // Load initial dashboard state if it was passed in
  if (initialState) {
    applyState(initialState);
  }

  // Always collapse the nav bar.
  //navBar.collapse();

  if(window.location.hash != '')
  {
    sendLoadRequest(window.location.hash.substr(1));
  }

  if (initialError) {
    Ext.Msg.alert("Error", initialError);
  }

}


function metricTypeSelected (combo, record, index) {
  selectedScheme = record;

  // Show only the fields for the selected context
  Ext.each(contextSelectorFields, function (field) {
    if (field.getId().indexOf( selectedScheme.get('name') ) == 0) {
      field.show();
    } else {
      field.hide();
    }
  });

  setContextFieldCookie("metric-type", combo.getValue());
  contextFieldChanged();
  focusCompleter();
}


function buildQuery (queryEvent) {
  var queryString = "";
  var parts = selectedScheme.get('pattern').split('.');
  var schemeName = selectedScheme.get('name');

  // Clear cached records to force JSON queries every time
  contextFieldStore.removeAll();
  delete queryEvent.combo.lastQuery;

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var field = part.match(/^<[^>]+>$/) ? part.substr(1, part.length - 2) : null;

    if (field == null) {
      queryString += part + '.';
      continue;
    }

    var combo = Ext.getCmp(schemeName + '-' + field);
    var value = combo.getValue();

    if (UI_CONFIG.automatic_variants) {
      if (value.indexOf(',') > -1 && value.search(/[{}]/) == -1) {
        value = '{' + value + '}';
      }
    }

    if (combo === queryEvent.combo) {
      queryEvent.query = queryString + queryEvent.query + '*';
      return;
    } else {
      if (value) {
        queryString += value + '.';
      } else {
        Ext.Msg.alert('Missing Context', 'Please fill out all of the fields above first.');
        queryEvent.cancel = true;
        return;
      }
    }
  }

  Ext.Msg.alert('Error', 'Failed to build query, could not find "' + queryEvent.combo.getId() + '" field');
  queryEvent.cancel = true;
}


function contextFieldChanged() {
  var pattern = getContextFieldsPattern();
  if (pattern) metricSelectorShow(pattern);
}

function getContextFieldsPattern() {
  var schemeName = selectedScheme.get('name');
  var pattern = selectedScheme.get('pattern');
  var fields = selectedScheme.get('fields');
  var missing_fields = false;

  Ext.each(fields, function (field) {
    var id = schemeName + '-' + field.name;
    var value = Ext.getCmp(id).getValue();

    // Update context field cookies
    setContextFieldCookie(field.name, value);

    if (UI_CONFIG.automatic_variants) {
      if (value.indexOf(',') > -1 && value.search(/[{}]/) == -1) {
        value = '{' + value + '}';
      }
    }

    if (value.trim() == "") {
      missing_fields = true;
    } else {
      pattern = pattern.replace('<' + field.name + '>', value);
    }
  });

  if (missing_fields) {
    return;
  }

  return pattern;
}

function metricSelectorShow(pattern) {
  if (metricSelectorMode == 'tree') {
    metricTreeSelectorShow(pattern);
  } else {
    metricTextSelectorShow(pattern);
  }
}

function metricTreeSelectorShow(pattern) {
  var base_parts = pattern.split('.');

  function setParams (loader, node, callback) {
    loader.baseParams.format = 'treejson';

    if (node.id == 'rootMetricSelectorNode') {
      loader.baseParams.query = pattern + '.*';
    } else {
      var id_parts = node.id.split('.');
      id_parts.splice(0, base_parts.length); //make it relative
      var relative_id = id_parts.join('.');
      loader.baseParams.query = pattern + '.' + relative_id + '.*';
    }
  }

  var loader = new Ext.tree.TreeLoader({
    url: '../metrics/find/',
    requestMethod: 'GET',
    listeners: {beforeload: setParams}
  });

  try {
    var oldRoot = Ext.getCmp('rootMetricSelectorNode');
    oldRoot.destroy();
  } catch (err) { }

  var root = new Ext.tree.AsyncTreeNode({
    id: 'rootMetricSelectorNode',
    loader: loader
  });

  metricSelector.setRootNode(root);
  root.expand();
}

function metricTextSelectorShow(pattern) {
  var store = metricSelectorGrid.getStore();
  store.setBaseParam('query', pattern);
  store.load();
}


function metricTreeSelectorNodeClicked (node, e) {
  if (!node.leaf) {
    node.toggle();
    return;
  }

  graphAreaToggle(node.id);
}


function graphAreaToggle(target, options) {
  /* The GraphRecord's id is their URL-encoded target=...&target=... string
     This function can get called with either the encoded string or just a raw
     metric path, eg. "foo.bar.baz".
  */
  var graphTargetString;
  if (target.substr(0,7) == "target=") {
    graphTargetString = target;
  } else {
    graphTargetString = "target=" + target;
  }
  var graphTargetList = Ext.urlDecode(graphTargetString)['target'];
  if (typeof graphTargetList == 'string') {
    graphTargetList = [graphTargetList];
  }

  var existingIndex = graphStore.findExact('target', graphTargetString);

  if (existingIndex > -1) {
    if ( (options === undefined) || (!options.dontRemove) ) {
      graphStore.removeAt(existingIndex);
    }
  } else if ( (options === undefined) || (!options.onlyRemove) ) {
    // Add it
    var myParams = {
      target: graphTargetList
    };
    var urlParams = {};
    Ext.apply(urlParams, defaultGraphParams);
    if (options && options.defaultParams) {
      Ext.apply(urlParams, options.defaultParams);
    }
    Ext.apply(urlParams, GraphSize);
    Ext.apply(urlParams, myParams);

    var record = new GraphRecord({
      target: graphTargetString,
      params: myParams,
      url: '/render/?' + Ext.urlEncode(urlParams)
    });
    graphStore.add([record]);
    updateGraphRecords();
  }
}


function updateGraphRecords() {
  graphStore.each(function (item, index) {
    var params = {};
    Ext.apply(params, defaultGraphParams);
    Ext.apply(params, item.data.params);
    Ext.apply(params, GraphSize);
    params._uniq = Math.random();
    if (params.title === undefined && params.target.length == 1) {
      params.title = params.target[0];
    }
    if (!params.uniq === undefined) {
        delete params["uniq"];
    }
    // DC - This is the url that is pulled on the dash, not the one stored.
    item.set('url', '../render/?' + Ext.urlEncode(params));
    item.set('width', GraphSize.width);
    item.set('height', GraphSize.height);
    item.set('index', index);
  });
}

function refreshGraphs() {
  updateGraphRecords();
  graphView.refresh();
  graphArea.getTopToolbar().get('last-refreshed-text').setText( (new Date()).format('g:i:s A') );
}

function updateAutoRefresh (newValue) {
  Ext.getCmp('auto-refresh-field').setValue(newValue);

  var value = parseInt(newValue);
  if ( isNaN(value) ) {
    return;
  }

  if (Ext.getCmp('auto-refresh-button').pressed) {
    stopTask(refreshTask);
    refreshTask.interval = value * 1000;
    startTask(refreshTask);
  } else {
    refreshTask.interval = value * 1000;
  }
}

/* Task management */
function stopTask(task) {
  if (task.running) {
    Ext.TaskMgr.stop(task);
    task.running = false;
  }
}

function startTask(task) {
  if (!task.running) {
    Ext.TaskMgr.start(task);
    task.running = true;
  }
}

/* Time Range management */
defaultGraphParams['from'].match(/([0-9]+)([^0-9]+)/);
var defaultRelativeQuantity = RegExp.$1;
var defaultRelativeUnits = RegExp.$2;
var TimeRange = {
  // Default to a relative time range
  type: 'relative',
  relativeStartQuantity: defaultRelativeQuantity,
  relativeStartUnits: defaultRelativeUnits,
  relativeUntilQuantity: '',
  relativeUntilUnits: 'now',
  // Absolute time range
  startDate: new Date(),
  startTime: "9:00 AM",
  endDate: new Date(),
  endTime: "5:00 PM"
};

function getTimeText() {
  if (TimeRange.type == 'relative') {
    var text = "Now showing the past " + TimeRange.relativeStartQuantity + " " + TimeRange.relativeStartUnits;
    if (TimeRange.relativeUntilUnits !== 'now' && TimeRange.relativeUntilQuantity !== '') {
      text = text + " until " + TimeRange.relativeUntilQuantity + " " + TimeRange.relativeUntilUnits + " ago";
    }
    return text;
  } else {
    var fmt = 'g:ia F jS Y';
    return "Now Showing " + TimeRange.startDate.format(fmt) + ' through ' + TimeRange.endDate.format(fmt);
  }
}

function updateTimeText() {
  graphArea.getTopToolbar().get('time-range-text').setText( getTimeText() );
}

function timeRangeUpdated() {

  if (TimeRange.type == 'relative') {
    var fromParam = '-' + TimeRange.relativeStartQuantity + TimeRange.relativeStartUnits;
    if (TimeRange.relativeUntilUnits == 'now') {
      var untilParam = 'now';
    } else {
      var untilParam = '-' + TimeRange.relativeUntilQuantity + TimeRange.relativeUntilUnits;
    }
  } else {
    var fromParam = TimeRange.startDate.format('H:i_Ymd');
    var untilParam = TimeRange.endDate.format('H:i_Ymd');
  }
  defaultGraphParams.from = fromParam;
  defaultGraphParams.until = untilParam;
  saveDefaultGraphParams();

  graphStore.each(function () {
    this.data.params.from = fromParam;
    this.data.params.until = untilParam;
  });

  updateTimeText();
  refreshGraphs();
}


function selectRelativeTime() {
  var quantityField = new Ext.form.TextField({
    fieldLabel: "Show the past",
    width: 90,
    allowBlank: false,
    regex: /\d+/,
    regexText: "Please enter a number",
    value: TimeRange.relativeStartQuantity
  });

  var unitField = new Ext.form.ComboBox({
    fieldLabel: "",
    width: 90,
    mode: 'local',
    editable: false,
    triggerAction: 'all',
    allowBlank: false,
    forceSelection: true,
    store: ['minutes', 'hours', 'days', 'weeks', 'months'],
    value: TimeRange.relativeStartUnits
  });

  var untilQuantityField = new Ext.form.TextField({
    id: 'until-quantity-field',
    fieldLabel: "Until",
    width: 90,
    allowBlank: true,
    regex: /\d+/,
    regexText: "Please enter a number",
    value: TimeRange.relativeUntilQuantity
  });

  var untilUnitField = new Ext.form.ComboBox({
    fieldLabel: "",
    width: 90,
    mode: 'local',
    editable: false,
    triggerAction: 'all',
    allowBlank: true,
    forceSelection: false,
    store: ['now', 'minutes', 'hours', 'days', 'weeks', 'months'],
    value: TimeRange.relativeUntilUnits,
    listeners: {
      select: function(combo, record, index) {
                  if (index == 0) {
                    Ext.getCmp('until-quantity-field').setValue('');
                    Ext.getCmp('until-quantity-field').setDisabled(true);
                  } else {
                    Ext.getCmp('until-quantity-field').setDisabled(false);
                  }
                },
      render: function(combo) {
                if (combo.getValue() == 'now') {
                  Ext.getCmp('until-quantity-field').setValue('');
                  Ext.getCmp('until-quantity-field').setDisabled(true);
                } else {
                  Ext.getCmp('until-quantity-field').setDisabled(false);
                }
              }
    }
  });


  var win;

  function updateTimeRange() {
    TimeRange.type = 'relative';
    TimeRange.relativeStartQuantity = quantityField.getValue();
    TimeRange.relativeStartUnits = unitField.getValue();
    TimeRange.relativeUntilQuantity = untilQuantityField.getValue();
    TimeRange.relativeUntilUnits = untilUnitField.getValue();
    win.close();
    timeRangeUpdated();
  }

  win = new Ext.Window({
    title: "Select Relative Time Range",
    width: 205,
    height: 170,
    resizable: false,
    modal: true,
    layout: 'form',
    labelAlign: 'right',
    labelWidth: 90,
    items: [quantityField, unitField, untilQuantityField, untilUnitField],
    buttonAlign: 'center',
    buttons: [
      {text: 'Ok', handler: updateTimeRange},
      {text: 'Cancel', handler: function () { win.close(); } }
    ]
  });
  win.show();
}

function selectAbsoluteTime() {
  var startDateField = new Ext.form.DateField({
    fieldLabel: 'Start Date',
    width: 125,
    value: TimeRange.startDate || ''
  });

  var startTimeField = new Ext.form.TimeField({
    fieldLabel: 'Start Time',
    width: 125,
    allowBlank: false,
    increment: 30,
    value: TimeRange.startTime || ''
  });

  var endDateField = new Ext.form.DateField({
    fieldLabel: 'End Date',
    width: 125,
    value: TimeRange.endDate || ''
  });

  var endTimeField = new Ext.form.TimeField({
    fieldLabel: 'End Time',
    width: 125,
    allowBlank: false,
    increment: 30,
    value: TimeRange.endTime || ''
  });

  var win;

  function updateTimeRange() {
    TimeRange.type = 'absolute';
    TimeRange.startDate = new Date(startDateField.getValue().format('Y/m/d ') + startTimeField.getValue());
    TimeRange.startTime = startTimeField.getValue();
    TimeRange.endDate = new Date(endDateField.getValue().format('Y/m/d ') + endTimeField.getValue());
    TimeRange.endTime = endTimeField.getValue();
    win.close();
    timeRangeUpdated();
  }

  win = new Ext.Window({
    title: "Select Absolute Time Range",
    width: 225,
    height: 180,
    resizable: false,
    modal: true,
    layout: 'form',
    labelAlign: 'right',
    labelWidth: 70,
    items: [startDateField, startTimeField, endDateField, endTimeField],
    buttonAlign: 'center',
    buttons: [
      {text: 'Ok', handler: updateTimeRange},
      {text: 'Cancel', handler: function () { win.close(); } }
    ]
  });
  win.show();
}


/* Graph size stuff */
var GraphSize = {
  width: UI_CONFIG.default_graph_width,
  height: UI_CONFIG.default_graph_height
};


function selectGraphSize() {
  var presetCombo = new Ext.form.ComboBox({
    fieldLabel: "Preset",
    width: 80,
    editable: false,
    forceSelection: true,
    triggerAction: 'all',
    mode: 'local',
    value: 'Custom',
    store: ['Custom', 'Small', 'Medium', 'Large'],
    listeners: {
      select: function (combo, record, index) {
                var w = "";
                var h = "";
                if (index == 1) { //small
                  w = 300;
                  h = 230;
                } else if (index == 2) { //medium
                  w = 400;
                  h = 300;
                } else if (index == 3) { //large
                  w = 500;
                  h = 400;
                }
                Ext.getCmp('width-field').setValue(w);
                Ext.getCmp('height-field').setValue(h);
              }
    }
  });

  var widthField = new Ext.form.TextField({
    id: 'width-field',
    fieldLabel: "Width",
    width: 80,
    regex: /\d+/,
    regexText: "Please enter a number",
    allowBlank: false,
    value: GraphSize.width || UI_CONFIG.default_graph_width
  });

  var heightField = new Ext.form.TextField({
    id: 'height-field',
    fieldLabel: "Height",
    width: 80,
    regex: /\d+/,
    regexText: "Please enter a number",
    allowBlank: false,
    value: GraphSize.height || UI_CONFIG.default_graph_height
  });

  var win;

  function resize() {
    GraphSize.width = defaultGraphParams.width = widthField.getValue();
    GraphSize.height = defaultGraphParams.height = heightField.getValue();
    saveDefaultGraphParams();
    win.close();
    refreshGraphs();
  }

  win = new Ext.Window({
    title: "Change Graph Size",
    width: 185,
    height: 160,
    resizable: false,
    layout: 'form',
    labelAlign: 'right',
    labelWidth: 80,
    modal: true,
    items: [presetCombo, widthField, heightField],
    buttonAlign: 'center',
    buttons: [
      {text: 'Ok', handler: resize},
      {text: 'Cancel', handler: function () { win.close(); } }
    ]
  });
  win.show();
}




/* Other stuff */
var targetGrid;
var activeMenu;

function removeUneditable (obj) {
  Ext.each(NOT_EDITABLE, function (p) {
    delete obj[p];
  });
  return obj;
}

function copyUneditable (src, dst) {
  Ext.each(NOT_EDITABLE, function (p) {
    if (src[p] === undefined) {
      delete dst[p];
    } else {
      dst[p] = src[p];
    }
  });
}

function breakoutGraph(record) {
  /* We have to gather some context from the
     graph target's expressions so we can reapply
     functions after the expressions get expanded. */
  var pathExpressions = [];
  var exprInfo = {};

  try {
    Ext.each(record.data.params.target, function(target) {
      var exprsInThisTarget = 0;
      map(target.split(','), function (arg) {
        var arglets = arg.split('(');
        map(arglets[arglets.length-1].split(')'), function (expr) {
          expr = expr.replace(/^\s*(.+?)\s*$/, '$1');
          if (expr.length == 0 || expr[0] == '"' || expr[0] == "'") return;

          if (expr.match(/[a-z].*\..*[a-z]/i)) {
            exprsInThisTarget++;
            if (exprsInThisTarget > 1) {
              throw 'arrr!';
            }

            pathExpressions.push(expr);
            var i = target.indexOf(expr);
            exprInfo[expr] = {
              expr: expr,
              pre: target.substr(0, i),
              post: target.substr(i + expr.length)
            }

          }

        }); //map arglets
      }); //map args
    }); //each target
  } catch (err) {
    Ext.Msg.alert("Graph contains unbreakable target", "Graph targets containing more than one metric expression cannot be broken out.");
    return;
  }

  Ext.Ajax.request({
    url: '../metrics/expand/',
    params: {
      groupByExpr: '1',
      leavesOnly: '1',
      query: pathExpressions
    },
    callback: function (options, success, response) {
                var responseObj = Ext.decode(response.responseText);
                graphStore.remove(record);
                for (var expr in responseObj.results) {
                  var pre = exprInfo[expr].pre;
                  var post = exprInfo[expr].post;
                  map(responseObj.results[expr], function (metricPath) {
                    metricPath = pre + metricPath + post;
                    graphAreaToggle(metricPath, {dontRemove: true, defaultParams: record.data.params});
                  });
                }
              }
  });
}

function mailGraph(record) {
  mygraphParams = record.get('params');
  mygraphParams['target'] = record.data['target'];
  newparams = Ext.encode(Ext.apply(mygraphParams, defaultGraphParams));

  var fromField = new Ext.form.TextField({
    fieldLabel: "From",
    name: 'sender',
    width: 300,
    allowBlank: false
  });

  var toField = new Ext.form.TextField({
    fieldLabel: "To",
    name: 'recipients',
    width: 300,
    allowBlank: false
  });

  var subjectField = new Ext.form.TextField({
    fieldLabel: "Subject",
    name: 'subject',
    width: 300,
    allowBlank: false
  });

  var msgField = new Ext.form.TextArea({
    fieldLabel: "Message",
    name: 'message',
    width: 300,
    height: 75
  });

  var graphParamsField = new Ext.form.TextField({
     name: 'graph_params',
     hidden: true,
     value: newparams
  });

  var contactForm = new Ext.form.FormPanel({
    width: 300,
    labelWidth: 90,
    items: [fromField, toField, subjectField, msgField, graphParamsField],
    buttons: [{
      text: 'Cancel',
      handler: function(){win.close();}
    }, {
         text: 'Send',
         handler: function(){
           if(contactForm.getForm().isValid()){
             contactForm.getForm().submit({
               url: '../dashboard/email/',
               waitMsg: 'Processing Request',
               success: function (contactForm, response) {
         console.log(response.result);
                 win.close();
               }
             });
           }
         }
     }]
  });

  var win;

  win = new Ext.Window({
    title: "Send graph via email",
    width: 450,
    height: 230,
    resizable: true,
    modal: true,
    layout: 'fit',
    items: [contactForm]
  });
  win.show();
}


function cloneGraph(record) {
  var index = graphStore.indexOf(record);
  var clone = cloneGraphRecord(record);
  graphStore.insert(index+1, [clone]);
  refreshGraphs();
}

function cloneGraphRecord(record) {
  //ensure we are working with copies, not references
  var props = {
    url: record.data.url,
    target: record.data.target,
    params: Ext.apply({}, record.data.params)
  };
  props.params.target = Ext.urlDecode(props.target).target;
  if (typeof props.params.target == "string") {
    props.params.target = [props.params.target];
  }
  return new GraphRecord(props);
}

function toggleToolbar() {
  var tbar = graphArea.getTopToolbar();
  tbar.setVisible( ! tbar.isVisible() );
  graphArea.doLayout();
}

function toggleNavBar() {
  //navBar.toggleCollapse(true);
}

function focusCompleter() {
  if (metricSelectorTextField) metricSelectorTextField.focus(false, 50);
}

/* Keyboard shortcuts */
var keyEventHandlers = {
};

var specialKeys = {
  space: 32,
  enter: Ext.EventObject.ENTER,
  backspace: Ext.EventObject.BACKSPACE
};

var keyMapConfigs = [];

for (var event_name in UI_CONFIG.keyboard_shortcuts) {
  var config = {handler: keyEventHandlers[event_name]};
  if (!config.handler) {
    continue;
  }
  var keyString = UI_CONFIG.keyboard_shortcuts[event_name];
  var keys = keyString.split('-');
  config.ctrl = keys.indexOf('ctrl') > -1;
  config.alt = keys.indexOf('alt') > -1;
  config.shift = keys.indexOf('shift') > -1;
  config.key = keys[keys.length - 1];
  if (specialKeys[config.key]) {
    config.key = specialKeys[config.key];
  }
  keyMapConfigs.push(config);
}

var keyMap = new Ext.KeyMap(document, keyMapConfigs);

/* Dashboard functions */




function sendSaveRequest(name) {
  Ext.Ajax.request({
    url: "../dashboard/save/",
    method: 'POST',
    params: {
      name : name,
      state: Ext.encode( getState() )
    },
    success: function (response) {
               var result = Ext.decode(response.responseText);
               if (result.error) {
                 Ext.Msg.alert("Error", "There was an error saving this dashboard: " + result.error);
               }
             },
    failure: failedAjaxCall
  });
}

function sendLoadRequest(name) {
  Ext.Ajax.request({
    url: "../dashboard/load/" + name,
    success: function (response) {
               var result = Ext.decode(response.responseText);
               if (result.error) {
                 Ext.Msg.alert("Error Loading Dashboard", result.error);
               } else {
                 applyState(result.state);
               }
             },
    failure: failedAjaxCall
  });
}

function getState() {
  var graphs = [];
  graphStore.each(
    function (record) {
      graphs.push([
        record.data.id,
        record.data.target,
        record.data.params,
        record.data.url
      ]);
    }
  );

  return {
    name: dashboardName,
    timeConfig: TimeRange,
    refreshConfig: {
      enabled: Ext.getCmp('auto-refresh-button').pressed,
      interval: refreshTask.interval
    },
    graphSize: GraphSize,
    defaultGraphParams: defaultGraphParams,
    graphs: graphs
  };
}

function applyState(state) {
  setDashboardName(state.name);

  //state.timeConfig = {type, quantity, units, untilQuantity, untilUnits, startDate, startTime, endDate, endTime}
  var timeConfig = state.timeConfig
  TimeRange.type = timeConfig.type;
  TimeRange.relativeStartQuantity = timeConfig.relativeStartQuantity;
  TimeRange.relativeStartUnits = timeConfig.relativeStartUnits;
  TimeRange.relativeUntilQuantity = timeConfig.relativeUntilQuantity;
  TimeRange.relativeUntilUnits = timeConfig.relativeUntilUnits;
  TimeRange.startDate = new Date(timeConfig.startDate);
  TimeRange.startTime = timeConfig.startTime;
  TimeRange.endDate = new Date(timeConfig.endDate);
  TimeRange.endTime = timeConfig.endTime;
  updateTimeText();

  //state.refreshConfig = {enabled, interval}
  var refreshConfig = state.refreshConfig;
  if (refreshConfig.enabled) {
    stopTask(refreshTask);
    startTask(refreshTask);
    Ext.getCmp('auto-refresh-button').toggle(true);
  } else {
    stopTask(refreshTask);
    Ext.getCmp('auto-refresh-button').toggle(false);
  }
  //refreshTask.interval = refreshConfig.interval;
  updateAutoRefresh(30000/ 1000);

  //state.graphSize = {width, height}
  var graphSize = state.graphSize;
  GraphSize.width = graphSize.width;
  GraphSize.height = graphSize.height;

  //state.defaultGraphParams = {...}
  defaultGraphParams = state.defaultGraphParams || originalDefaultGraphParams;

  //state.graphs = [ [id, target, params, url], ... ]
  graphStore.loadData(state.graphs);

  refreshGraphs();
}


function slugify(text) {
	text = text.replace(/[^_-a-zA-Z0-9,&\s]+/ig, '');
	text = text.replace(/\s/gi, "-");
	return text.toLowerCase();
}

function setDashboardName(name) {
  /*dashboardName = name;
  var saveButton = Ext.getCmp('dashboard-save-button');

  if (name == null) {
    dashboardURL = null;
    document.title = "untitled - Graphite Dashboard";
    //navBar.setTitle("untitled");
    //saveButton.setText("Save");
    saveButton.disable();

  } else {

    var urlparts = location.href.split('#')[0].split('/');
    var i = urlparts.indexOf('dashboard');
    if (i == -1) {
      Ext.Msg.alert("Error", "urlparts = " + Ext.encode(urlparts) + " and indexOf(dashboard) = " + i);
      return;
    }
    urlparts = urlparts.slice(0, i+1);
    urlparts.push( slugify(name) );
    dashboardURL = urlparts.join('/');

    document.title = name + " - Graphite Dashboard";
    window.location.hash = slugify(name);
    //navBar.setTitle(name + " - (" + dashboardURL + ")");
    //saveButton.setText('Save "' + name + '"');
    //saveButton.enable();
  }*/
}

function failedAjaxCall(response, options) {
  Ext.Msg.alert(
    "Ajax Error",
    "Ajax call failed, response was :" + response.responseText
  );
}

var configure_ui_win;
function configureUI() {

  if (configure_ui_win) {
    configure_ui_win.close();
  }

  function updateOrientation() {
    if (Ext.getCmp('navbar-left-radio').getValue()) {
      updateNavBar('west');
    } else {
      updateNavBar('north');
    }
    configure_ui_win.close();
    configure_ui_win = null;
  }

  configure_ui_win = new Ext.Window({
    title: "Configure UI",
    layout: 'form',
    width: 300,
    height: 125,
    labelWidth: 120,
    labelAlign: 'right',
    items: [
      {
        id: 'navbar-left-radio',
        xtype: "radio",
        fieldLabel: "Navigation Mode",
        boxLabel: "Tree (left nav)",
        name: "navbar-position",
        inputValue: "left",
        checked: (NAV_BAR_REGION == 'west')
      }, {
        id: 'navbar-top-radio',
        xtype: "radio",
        fieldLabel: "",
        boxLabel: "Completer (top nav)",
        name: "navbar-position",
        inputValue: "top",
        checked: (NAV_BAR_REGION == 'north')
      }
    ],
    buttons: [
      {text: 'Ok', handler: updateOrientation},
      {text: 'Cancel', handler: function () { configure_ui_win.close(); configure_ui_win = null; } }
    ]
  });
  configure_ui_win.show();
}

function updateNavBar(region) {
  if (region == NAV_BAR_REGION) {
    return;
  }

  cookieProvider.set('navbar-region', region);
  NAV_BAR_REGION = region;

  if (graphStore.getCount() == 0) {
    window.location.reload()
  } else {
    Ext.Msg.alert('Cookie Updated', "You must refresh the page to update the nav bar's location.");
    //TODO prompt the user to save their dashboard and refresh for them
  }
}

// Dashboard Finder
function showDashboardFinder() {
  var win;
  var dashboardsList;
  var queryField;
  var dashboardsStore = new Ext.data.JsonStore({
    url: "../dashboard/find/",
    method: 'GET',
    params: {query: "e"},
    fields: ['name', 'slug'],
    root: 'dashboards',
    listeners: {
      beforeload: function (store) {
                    store.setBaseParam('query', queryField.getValue());
                  }
    }
  });

  function openSelected() {
    var selected = dashboardsList.getSelectedRecords();
    if (selected.length > 0) {
      sendLoadRequest(selected[0].data.slug);
    }
    win.close();
  }



  dashboardsList = new Ext.list.ListView({
    columns: [
      {header: 'Dashboard', width: 1.0, dataIndex: 'name', sortable: false}
    ],
    columnSort: false,
    emptyText: "No dashboards found",
    hideHeaders: true,
    listeners: {
      selectionchange: function (listView, selections) {
                         if (listView.getSelectedRecords().length == 0) {
                           Ext.getCmp('finder-open-button').disable();
                           Ext.getCmp('finder-delete-button').disable();
                         } else {
                           Ext.getCmp('finder-open-button').enable();
                           Ext.getCmp('finder-delete-button').enable();
                         }
                       },

      dblclick: function (listView, index, node, e) {
                  var record = dashboardsStore.getAt(index);
                  sendLoadRequest(record.data.slug);
                  win.close();
                }
    },
    overClass: '',
    region: 'center',
    reserveScrollOffset: true,
    singleSelect: true,
    store: dashboardsStore,
    style: "background-color: white;"
  });

  var lastQuery = null;
  var queryUpdateTask = new Ext.util.DelayedTask(
    function () {
      var currentQuery = queryField.getValue();
      if (lastQuery != currentQuery) {
        dashboardsStore.load();
      }
      lastQuery = currentQuery;
    }
  );

  queryField = new Ext.form.TextField({
    region: 'south',
    emptyText: "filter dashboard listing",
    enableKeyEvents: true,
    listeners: {
      keyup: function (field, e) {
                  if (e.getKey() == e.ENTER) {
                    sendLoadRequest(field.getValue());
                    win.close();
                  } else {
                    queryUpdateTask.delay(FINDER_QUERY_DELAY);
                  }
                }
    }
  });

  win = new Ext.Window({
    title: "Dashboard Finder",
    width: 400,
    height: 500,
    layout: 'border',
    modal: true,
    items: [
      dashboardsList,
      queryField
    ],
    buttons: [
      {
        id: 'finder-open-button',
        text: "Open",
        disabled: true,
        handler: openSelected
      },{
        text: "Close",
        handler: function () { win.close(); }
      }
    ]
  });
  dashboardsStore.load();
  win.show();
}

/* Graph Options API (to reuse createOptionsMenu from composer_widgets.js) */
function updateGraph() {
  refreshGraphs();
  var graphMenuParams = Ext.getCmp('graphMenuParams');
  if (graphMenuParams) {
    var editParams = Ext.apply({}, selectedRecord.data.params);
    removeUneditable(editParams);
    graphMenuParams.setValue( Ext.urlEncode(editParams) );
  }
}

function getParam(param) {
  return selectedRecord.data.params[param];
}

function setParam(param, value) {
  selectedRecord.data.params[param] = value;
  selectedRecord.commit();
}

function removeParam(param) {
  delete selectedRecord.data.params[param];
  selectedRecord.commit();
}


/* Target Functions API (super-ghetto) */
function addTargetToSelectedGraph(target) {
  selectedRecord.data.params.target.push(target);
  selectedRecord.data.target = Ext.urlEncode({target: selectedRecord.data.params.target});
}

function removeTargetFromSelectedGraph(target) {
  selectedRecord.data.params.target.remove(target);
  selectedRecord.data.target = Ext.urlEncode({target: selectedRecord.data.params.target});
}

function getSelectedTargets() {
  if (targetGrid) {
    return map(targetGrid.getSelectionModel().getSelections(), function (r) {
      return r.data.target;
    });
  }
  return [];
}

function applyFuncToEach(funcName, extraArg) {

  function applyFunc() {
    Ext.each(targetGrid.getSelectionModel().getSelections(),
      function (record) {
        var target = record.data.target;
        var newTarget;
        var targetStore = targetGrid.getStore();

        targetStore.remove(record);
        removeTargetFromSelectedGraph(target);

        if (extraArg) {
          if (funcName == 'mostDeviant') { //SPECIAL CASE HACK
            newTarget = funcName + '(' + extraArg + ',' + target + ')';
          } else {
            newTarget = funcName + '(' + target + ',' + extraArg + ')';
          }
        } else {
          newTarget = funcName + '(' + target + ')';
        }

        // Add newTarget to selectedRecord
        targetStore.add([ new targetStore.recordType({target: newTarget}, newTarget) ]);
        addTargetToSelectedGraph(newTarget);
        targetGrid.getSelectionModel().selectRow(targetStore.findExact('target', newTarget), true);
      }
    );
    refreshGraphs();
  }
  return applyFunc;
}

function applyFuncToEachWithInput (funcName, question, options) {
  if (options == null) {
    options = {};
  }

 function applyFunc() {
    Ext.MessageBox.prompt(
      "Input Required", //title
      question, //message
      function (button, inputValue) { //handler
        if (button == 'ok' && (options.allowBlank || inputValue != '')) {
          if (options.quote) {
            inputValue = '"' + inputValue + '"';
          }
          applyFuncToEach(funcName, inputValue)();
        }
      },
      this, //scope
      false, //multiline
      "" //initial value
    );
  }
  applyFunc = applyFunc.createDelegate(this);
  return applyFunc;
}

function applyFuncToAll (funcName) {
  function applyFunc() {
    var args = getSelectedTargets().join(',');
    var newTarget = funcName + '(' + args + ')';
    var targetStore = targetGrid.getStore();

    Ext.each(targetGrid.getSelectionModel().getSelections(),
      function (record) {
        targetStore.remove(record);
        removeTargetFromSelectedGraph(record.data.target);
      }
    );
    targetStore.add([ new targetStore.recordType({target: newTarget}, newTarget) ]);
    addTargetToSelectedGraph(newTarget);
    targetGrid.getSelectionModel().selectRow(targetStore.findExact('target', newTarget), true);
    refreshGraphs();
  }
  applyFunc = applyFunc.createDelegate(this);
  return applyFunc;
}

function removeOuterCall() { // blatantly repurposed from composer_widgets.js (don't hate)
  Ext.each(targetGrid.getSelectionModel().getSelections(), function (record) {
    var target = record.data.target;
    var targetStore = targetGrid.getStore();
    var args = [];
    var i, c;
    var lastArg = 0;
    var depth = 0;
    var argString = target.replace(/^[^(]+\((.+)\)/, "$1"); //First we strip it down to just args

    for (i = 0; i < argString.length; i++) {
      switch (argString.charAt(i)) {
        case '(': depth += 1; break;
        case ')': depth -= 1; break;
        case ',':
          if (depth > 0) { continue; }
          if (depth < 0) { Ext.Msg.alert("Malformed target, cannot remove outer call."); return; }
          args.push( argString.substring(lastArg, i).replace(/^\s+/, '').replace(/\s+$/, '') );
          lastArg = i + 1;
          break;
      }
    }
    args.push( argString.substring(lastArg, i) );

    targetStore.remove(record);
    selectedRecord.data.params.target.remove(target);

    Ext.each(args, function (arg) {
      if (!arg.match(/^([0123456789\.]+|".+")$/)) { //Skip string and number literals
        targetStore.add([ new targetStore.recordType({target: arg}) ]);
        selectedRecord.data.params.target.push(arg);
        targetGrid.getSelectionModel().selectRow(targetStore.findExact('target', arg), true);
      }
    });
  });
  refreshGraphs();
}

function saveDefaultGraphParams() {
  cookieProvider.set('defaultGraphParams', Ext.encode(defaultGraphParams));
}


/* Cookie stuff */
function getContextFieldCookie(field) {
  return cookieProvider.get(field);
}

function setContextFieldCookie(field, value) {
  cookieProvider.set(field, value);
}

/* Misc */
function uniq(myArray) {
  var uniqArray = [];
  for (var i=0; i<myArray.length; i++) {
    if (uniqArray.indexOf(myArray[i]) == -1) {
      uniqArray.push(myArray[i]);
    }
  }
  return uniqArray;
}

function map(myArray, myFunc) {
  var results = [];
  for (var i=0; i<myArray.length; i++) {
    results.push( myFunc(myArray[i]) );
  }
  return results;
}



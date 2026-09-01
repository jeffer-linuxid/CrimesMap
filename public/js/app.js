document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const CONFIG = Object.freeze({
    api: {
      crimes: '/api/crimes',
      search: 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
    },
    map: {
      initialCenter: [0, 0],
      initialZoom: 1,
      searchZoom: 14,
      crimeRadius: 150
    },
    files: {
      exportName: 'crimes.json'
    }
  });

  const elements = {
    map: document.getElementById('map'),
    btnSat: document.getElementById('btnSat'),
    btnMap: document.getElementById('btnMap'),
    btnSearch: document.getElementById('btnSearch'),
    btnAdd: document.getElementById('btnAdd'),
    btnExport: document.getElementById('btnExport'),
    btnImport: document.getElementById('btnImport'),
    search: document.getElementById('search'),
    fileInput: document.getElementById('fileimport'),
    overlay: document.getElementById('overlay'),
    formPopup: document.getElementById('formPopup'),
    confirmAdd: document.getElementById('confirmAdd'),
    cancelAdd: document.getElementById('cancelAdd'),
    type: document.getElementById('type'),
    description: document.getElementById('description'),
    bairro: document.getElementById('bairro'),
    city: document.getElementById('city')
  };

  const state = {
    crimes: new Map(),
    pendingLocation: null,
    activeLayer: null
  };

  class CrimeApi {
    static async getAll() {
      const response = await fetch(CONFIG.api.crimes);

      if (!response.ok) {
        throw new Error(`Erro ao carregar crimes: HTTP ${response.status}`);
      }

      return response.json();
    }

    static async create(crime) {
      const response = await fetch(CONFIG.api.crimes, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(crime)
      });

      if (!response.ok) {
        throw new Error(`Erro ao salvar crime: HTTP ${response.status}`);
      }

      return response.json().catch(() => null);
    }

    static async createMany(crimes) {
      const response = await fetch(CONFIG.api.crimes, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(crimes)
      });

      if (!response.ok) {
        throw new Error(`Erro ao importar crimes: HTTP ${response.status}`);
      }

      return response.json().catch(() => null);
    }

    static async remove(id) {
      const response = await fetch(
        `${CONFIG.api.crimes}/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error(`Erro ao remover crime: HTTP ${response.status}`);
      }

      return response.json().catch(() => null);
    }
  }

  class LocationSearch {
    static async search(query) {
      const response = await fetch(
        CONFIG.api.search + encodeURIComponent(query),
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Erro na pesquisa: HTTP ${response.status}`);
      }

      return response.json();
    }
  }

  class CrimeValidator {
    static normalize(data) {
      return {
        id: data.id ?? crypto.randomUUID(),
        latitude: Number(
          data.latitude ??
          data.lat ??
          data.Latitude
        ),
        longitude: Number(
          data.longitude ??
          data.lng ??
          data.long ??
          data.lon ??
          data.Longitude
        ),
        type: String(
          data.type ??
          data.tipo ??
          ''
        ).trim(),
        description: String(
          data.description ??
          data.descricao ??
          ''
        ).trim(),
        bairro: String(
          data.bairro ??
          ''
        ).trim(),
        city: String(
          data.city ??
          data.cidade ??
          ''
        ).trim(),
        data:
          data.data ??
          data.date ??
          new Date().toISOString()
      };
    }

    static isValidLocation(crime) {
      return (
        Number.isFinite(crime.latitude) &&
        Number.isFinite(crime.longitude) &&
        crime.latitude >= -90 &&
        crime.latitude <= 90 &&
        crime.longitude >= -180 &&
        crime.longitude <= 180
      );
    }

    static isValid(crime) {
      return (
        this.isValidLocation(crime) &&
        Boolean(crime.type) &&
        Boolean(crime.description) &&
        Boolean(crime.bairro) &&
        Boolean(crime.city)
      );
    }
  }

  class Html {
    static escape(value) {
      const element = document.createElement('div');
      element.textContent = String(value ?? '');
      return element.innerHTML;
    }
  }

  class MapManager {
    constructor() {
      this.map = L.map(elements.map).setView(
        CONFIG.map.initialCenter,
        CONFIG.map.initialZoom
      );

      this.layers = {
        normal: L.tileLayer(
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
          }
        ),
        satellite: L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            maxZoom: 19,
            attribution: '© Esri'
          }
        )
      };

      this.layers.normal.addTo(this.map);
      state.activeLayer = this.layers.normal;
    }

    showNormal() {
      this.switchLayer(this.layers.normal);
    }

    showSatellite() {
      this.switchLayer(this.layers.satellite);
    }

    switchLayer(layer) {
      if (state.activeLayer === layer) {
        return;
      }

      if (this.map.hasLayer(state.activeLayer)) {
        this.map.removeLayer(state.activeLayer);
      }

      layer.addTo(this.map);
      state.activeLayer = layer;
    }

    setView(latitude, longitude, zoom) {
      this.map.setView([latitude, longitude], zoom);
    }

    onceClick(callback) {
      this.map.once('click', callback);
    }

    addLayer(layer) {
      layer.addTo(this.map);
    }

    removeLayer(layer) {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    }
  }

  class CrimeForm {
    open() {
      elements.overlay.style.display = 'block';
      elements.formPopup.style.display = 'block';
    }

    close() {
      elements.overlay.style.display = 'none';
      elements.formPopup.style.display = 'none';
    }

    clear() {
      elements.type.value = '';
      elements.description.value = '';
      elements.bairro.value = '';
      elements.city.value = '';
    }

    getData() {
      return {
        type: elements.type.value.trim(),
        description: elements.description.value.trim(),
        bairro: elements.bairro.value.trim(),
        city: elements.city.value.trim()
      };
    }
  }

  class CrimeManager {
    constructor(mapManager) {
      this.mapManager = mapManager;
      this.markers = new Map();
    }

    add(crime) {
      const normalized = CrimeValidator.normalize(crime);

      if (!CrimeValidator.isValid(normalized)) {
        console.warn('Crime inválido:', normalized);
        return null;
      }

      const id = normalized.id;

      state.crimes.set(id, normalized);

      const marker = this.createMarker(
        id,
        normalized
      );

      this.markers.set(id, marker);

      return normalized;
    }

    createMarker(id, crime) {
      const marker = L.circle(
        [crime.latitude, crime.longitude],
        {
          color: 'red',
          fillColor: '#f03',
          fillOpacity: 0.5,
          radius: CONFIG.map.crimeRadius
        }
      );

      marker.bindPopup(
        this.createPopup(crime)
      );

      marker.on('dblclick', () => {
        this.remove(id);
      });

      marker.on('popupopen', () => {
        const popup = marker.getPopup();

        const button = popup
          ?.getElement()
          ?.querySelector('.report-whatsapp');

        button?.addEventListener('click', () => {
          this.reportWhatsApp(crime);
        });
      });

      this.mapManager.addLayer(marker);

      return marker;
    }

    createPopup(crime) {
      return `
        <div class="crime-popup">
          <strong>Tipo:</strong>
          ${Html.escape(crime.type)}
          <br>

          <strong>Descrição:</strong>
          ${Html.escape(crime.description)}
          <br>

          <strong>Bairro:</strong>
          ${Html.escape(crime.bairro)}
          <br>

          <strong>Cidade:</strong>
          ${Html.escape(crime.city)}
          <br>

          <strong>Data:</strong>
          ${Html.escape(
            new Date(crime.data).toLocaleString('pt-BR')
          )}

          <br><br>

          <button
            type="button"
            class="report-whatsapp"
          >
            Reportar via WhatsApp
          </button>
        </div>
      `;
    }

    reportWhatsApp(crime) {
      const message =
        `Crime reportado: ${crime.description}`;

      const url =
        `https://wa.me/?text=${encodeURIComponent(message)}`;

      window.open(
        url,
        '_blank',
        'noopener,noreferrer'
      );
    }

    async remove(id) {
      const marker = this.markers.get(id);

      if (!marker) {
        return;
      }

      if (!window.confirm('Deseja remover este crime?')) {
        return;
      }

      try {
        await CrimeApi.remove(id);
      } catch (error) {
        console.error('Erro ao remover crime no servidor:', error);
        alert('Não foi possível remover o crime no servidor.');
        return;
      }

      this.mapManager.removeLayer(marker);

      this.markers.delete(id);
      state.crimes.delete(id);
    }

    addMany(crimes) {
      return crimes
        .map(crime => this.add(crime))
        .filter(Boolean);
    }

    getAll() {
      return [...state.crimes.values()];
    }
  }

  class CrimeFileService {
    constructor(crimeManager) {
      this.crimeManager = crimeManager;
    }

    export() {
      const data = JSON.stringify(
        this.crimeManager.getAll(),
        null,
        2
      );

      const blob = new Blob(
        [data],
        {
          type: 'application/json'
        }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = CONFIG.files.exportName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    }

    async import(file) {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed)) {
        throw new Error(
          'O JSON precisa conter um array.'
        );
      }

      const crimes = parsed
        .map(crime =>
          CrimeValidator.normalize(crime)
        )
        .filter(crime =>
          CrimeValidator.isValid(crime)
        );

      if (!crimes.length) {
        throw new Error(
          'Nenhum crime válido encontrado.'
        );
      }

      this.crimeManager.addMany(crimes);

      await CrimeApi.createMany(crimes);

      return crimes.length;
    }
  }

  const mapManager = new MapManager();
  const crimeManager = new CrimeManager(mapManager);
  const crimeForm = new CrimeForm();
  const fileService = new CrimeFileService(crimeManager);

  elements.btnSat.addEventListener(
    'click',
    () => mapManager.showSatellite()
  );

  elements.btnMap.addEventListener(
    'click',
    () => mapManager.showNormal()
  );

  async function searchLocation() {
    const query = elements.search.value.trim();

    if (!query) {
      return;
    }

    try {
      const results =
        await LocationSearch.search(query);

      if (!results.length) {
        alert('Local não encontrado!');
        return;
      }

      mapManager.setView(
        Number(results[0].lat),
        Number(results[0].lon),
        CONFIG.map.searchZoom
      );
    } catch (error) {
      console.error(error);
      alert('Erro ao pesquisar localização.');
    }
  }

  elements.btnSearch.addEventListener(
    'click',
    searchLocation
  );

  elements.search.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Enter') {
        searchLocation();
      }
    }
  );

  elements.btnAdd.addEventListener(
    'click',
    () => {
      alert(
        'Clique no mapa para escolher o local do crime.'
      );

      mapManager.onceClick(event => {
        state.pendingLocation = event.latlng;
        crimeForm.open();
      });
    }
  );

  elements.cancelAdd.addEventListener(
    'click',
    () => {
      state.pendingLocation = null;
      crimeForm.close();
      crimeForm.clear();
    }
  );

  elements.confirmAdd.addEventListener(
    'click',
    async () => {
      if (!state.pendingLocation) {
        alert('Selecione um local no mapa.');
        return;
      }

      const crime = CrimeValidator.normalize({
        ...crimeForm.getData(),
        latitude: state.pendingLocation.lat,
        longitude: state.pendingLocation.lng,
        data: new Date().toISOString()
      });

      if (!CrimeValidator.isValid(crime)) {
        alert(
          'Preencha todos os campos corretamente.'
        );
        return;
      }

      crimeManager.add(crime);

      try {
        await CrimeApi.create(crime);
      } catch (error) {
        console.error(
          'Erro ao salvar crime:',
          error
        );

        alert(
          'O crime foi adicionado ao mapa, mas não foi salvo no servidor.'
        );
      }

      state.pendingLocation = null;
      crimeForm.close();
      crimeForm.clear();
    }
  );

  elements.btnExport.addEventListener(
    'click',
    () => fileService.export()
  );

  if (elements.btnImport) {
    elements.btnImport.addEventListener(
      'click',
      () => elements.fileInput.click()
    );
  }

  elements.fileInput.addEventListener(
    'change',
    async event => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      try {
        const count =
          await fileService.import(file);

        alert(
          `Importados ${count} crimes.`
        );
      } catch (error) {
        console.error(error);

        alert(
          error.message ||
          'Erro ao importar arquivo JSON.'
        );
      } finally {
        event.target.value = '';
      }
    }
  );

  async function loadCrimes() {
    try {
      const crimes = await CrimeApi.getAll();

      crimeManager.addMany(crimes);
    } catch (error) {
      console.error(
        'Erro ao carregar crimes:',
        error
      );
    }
  }

  loadCrimes();
});
// Remove the static products array and replace with async loading
let products = [];

// Function to fetch products from our server's Printful API endpoint
async function fetchProducts() {
    try {
        console.log('Fetching products from server...');
        const response = await fetch('/api/products');
        if (!response.ok) {
            throw new Error('Failed to fetch products');
        }
        const data = await response.json();
        
        // Detailed logging of server response
        console.log('=== Server Response Details ===');
        console.log('Number of products received:', data.length);
        
        data.forEach(product => {
            console.log(`\nProduct: ${product.name} (ID: ${product.id})`);
            console.log('Number of variants:', product.variants?.length || 0);
            
            // Log the first variant in detail
            if (product.variants && product.variants.length > 0) {
                const firstVariant = product.variants[0];
                console.log('First variant structure:', {
                    id: firstVariant.id,
                    color: firstVariant.color,
                    size: firstVariant.size,
                    preview_url: firstVariant.preview_url,
                    has_mockup_files: Boolean(firstVariant.mockup_files?.length),
                    has_files: Boolean(firstVariant.files?.length)
                });
                
                // Log all available colors
                const colors = [...new Set(product.variants.map(v => v.color))];
                console.log('Available colors:', colors);
                
                // Check preview URLs for each color
                colors.forEach(color => {
                    const colorVariant = product.variants.find(v => v.color === color);
                    if (colorVariant) {
                        console.log(`Preview URL for ${color}:`, colorVariant.preview_url);
                    }
                });
            }
        });
        
        // Process the products as before
        products = data.map(product => {
            // Get retail price from either the product or its first variant
            const retail_price = product.retail_price || 
                                (product.variants && product.variants[0] ? product.variants[0].retail_price : 0);
            
            return {
                id: product.id,
                name: product.name,
                description: product.description || '',
                retail_price: retail_price,
                category: product.type || 'clothing',
                thumbnail_url: product.thumbnail_url,
                variants: product.variants.map(variant => ({
                    id: variant.id,
                    size: variant.size,
                    color: variant.color,
                    in_stock: variant.in_stock,
                    stock_level: variant.stock_level,
                    preview_url: variant.preview_url,
                    retail_price: variant.retail_price || retail_price,
                    files: variant.files || [],
                    mockup_files: variant.mockup_files || []
                }))
            };
        });
        
        return products;
    } catch (error) {
        console.error('Error fetching products:', error);
        document.querySelector('.products-grid').innerHTML = `
            <div class="error-message">
                <p>Failed to load products. Please try again later.</p>
                <button onclick="loadProducts()" class="retry-button">Retry</button>
            </div>
        `;
    }
}

// Function to get the best image URL from a variant
function getBestImageUrl(variant) {
    if (!variant) {
        console.log('No variant provided to getBestImageUrl');
        return null;
    }

    console.log('\n=== Getting best image URL for variant ===');
    console.log('Variant:', {
        id: variant.id,
        color: variant.color,
        size: variant.size,
        files: variant.files?.length || 0,
        mockup_files: variant.mockup_files?.length || 0,
        preview_url: variant.preview_url
    });
    
    // First check mockup files
    if (variant.mockup_files && variant.mockup_files.length > 0) {
        const mockupFile = variant.mockup_files.find(f => f.preview_url);
        if (mockupFile && mockupFile.preview_url) {
            console.log('Using mockup file preview URL:', mockupFile.preview_url);
            return mockupFile.preview_url;
        }
    }
    
    // Then check regular files for front view
    if (variant.files && variant.files.length > 0) {
        console.log('\nChecking files:', variant.files.map(f => ({
            filename: f.filename,
            type: f.type,
            preview_url: f.preview_url,
            is_temporary: f.is_temporary
        })));
        
        // Try to find a front view file
        const frontFile = variant.files.find(f => 
            f.filename && 
            f.filename.toLowerCase().includes('front') && 
            f.preview_url &&
            !f.is_temporary
        );
        
        if (frontFile && frontFile.preview_url) {
            console.log('Found front view file:', frontFile.filename);
            console.log('Using front view preview URL:', frontFile.preview_url);
            return frontFile.preview_url;
        }

        // If no front view, use the first available preview URL
        const firstFileWithPreview = variant.files.find(f => f.preview_url && !f.is_temporary);
        if (firstFileWithPreview) {
            console.log('Using first available file preview URL:', firstFileWithPreview.preview_url);
            return firstFileWithPreview.preview_url;
        }
    }
    
    // Then try the preview URL directly
    if (variant.preview_url) {
        console.log('Using variant preview URL:', variant.preview_url);
        return variant.preview_url;
    }
    
    console.log('No suitable image found, returning null');
    return null;
}

// Modified loadProducts function
async function loadProducts() {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>Loading products...</p>
        </div>
    `;

    await fetchProducts();
    
    grid.innerHTML = '';
    products.forEach(product => {
        console.log('Rendering product:', product);
        
        // Add defensive check for retail price and ensure it's a number
        const retailPrice = parseFloat(product.retail_price) || 0;
        console.log('Product retail price:', retailPrice);

        // Get unique colors using case-insensitive comparison
        const uniqueColors = [];
        product.variants.forEach(variant => {
            if (variant.color && !uniqueColors.find(c => c.toLowerCase() === variant.color.toLowerCase())) {
                uniqueColors.push(variant.color);
            }
        });
        console.log('Unique colors for product:', uniqueColors);

        // Find the first variant with a mockup file or preview URL
        const defaultVariant = product.variants.find(v => v.mockup_files?.length > 0) || 
                             product.variants.find(v => v.preview_url) ||
                             product.variants[0];
        
        const defaultImage = defaultVariant ? getBestImageUrl(defaultVariant) : 
                           (product.thumbnail_url || 'assets/placeholder.png');
        
        console.log('Default variant:', defaultVariant?.id);
        console.log('Default image:', defaultImage);

        const productElement = document.createElement('article');
        productElement.className = 'product-item';
        productElement.dataset.category = product.category;
        productElement.id = `product-${product.id}`;
        
        const colorOptionsHtml = uniqueColors.length > 0 ? `
            <div class="color-options">
                ${uniqueColors.map(color => {
                    const variant = product.variants.find(v => v.color === color);
                    const colorCode = getColorCode(color);
                    console.log(`Creating color button for ${color}:`, colorCode);
                    return `
                        <button 
                            class="color-circle ${color === uniqueColors[0] ? 'selected' : ''}" 
                            data-color="${color}"
                            data-product-id="${product.id}"
                            style="background-color: ${colorCode}"
                            title="${color}"
                            onclick="selectColor(${product.id}, '${color.replace(/'/g, "\\'")}')">
                        </button>`;
                }).join('')}
            </div>
            <div class="selected-color" style="min-height: 20px; margin-bottom: 15px;">
                Selected: ${uniqueColors[0]}
            </div>
        ` : '';

        productElement.innerHTML = `
            <div class="product-image-container" data-product-id="${product.id}">
                <div class="loading-spinner"></div>
                <img src="${defaultImage}" 
                     alt="${product.name}" 
                     class="product-image"
                     loading="lazy">
            </div>
            <div class="product-details">
                <h3 class="product-name">${product.name}</h3>
                <p class="product-description">${product.description}</p>
                <p class="product-price">$${retailPrice.toFixed(2)}</p>
                
                <div class="product-variants">
                    ${colorOptionsHtml}
                    
                    ${product.variants.some(v => v.size) ? `
                        <div class="variant-group">
                            <select class="size-select" data-product-id="${product.id}">
                                <option value="">Select Size</option>
                                ${getAvailableSizes(product, uniqueColors[0])}
                            </select>
                        </div>
                    ` : ''}
                </div>
                
                <button onclick="addToCart(${JSON.stringify({...product, retail_price: retailPrice}).replace(/"/g, '&quot;')})" 
                        class="buy-button">
                    Add to Cart
                </button>
            </div>
        `;

        grid.appendChild(productElement);

        // Handle the default image load
        const imgElement = productElement.querySelector('.product-image');
        const loadingSpinner = productElement.querySelector('.loading-spinner');
        
        // Show loading spinner initially
        loadingSpinner.style.display = 'block';
        imgElement.style.opacity = '0';
        
        if (defaultImage) {
            // Create a new image object to preload
            const newImage = new Image();
            newImage.onload = () => {
                imgElement.src = defaultImage;
                requestAnimationFrame(() => {
                    imgElement.style.opacity = '1';
                    loadingSpinner.style.display = 'none';
                });
                console.log('Image loaded successfully:', defaultImage);
            };

            newImage.onerror = () => {
                console.error('Failed to load image:', defaultImage);
                // Try to use the product's thumbnail as fallback
                if (product.thumbnail_url && product.thumbnail_url !== defaultImage) {
                    imgElement.src = product.thumbnail_url;
                }
                requestAnimationFrame(() => {
                    imgElement.style.opacity = '1';
                    loadingSpinner.style.display = 'none';
                });
            };

            // Start loading the image
            newImage.src = defaultImage;
        } else {
            // No image available
            loadingSpinner.style.display = 'none';
            imgElement.style.opacity = '1';
            console.error('No image available for product:', product.name);
        }
    });
}

// Helper function to get available sizes for a color
function getAvailableSizes(product, color) {
    const sizes = product.variants
        .filter(v => v.color.toLowerCase() === color.toLowerCase() && v.availability_status === 'active')
        .map(v => v.size);
    
    // Sort sizes in a logical order
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
    sizes.sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
    
    return sizes.map(size => `<option value="${size}">${size}</option>`).join('');
}

// Helper function to get color codes
function getColorCode(colorName) {
    if (!colorName) return '#000000';
    
    const colorMap = {
        // Basic colors
        "Black": "#000000",
        "White": "#FFFFFF",
        "Navy": "#000080",
        "Red": "#FF0000",
        "Green": "#008000",
        "Blue": "#0000FF",
        "Yellow": "#FFFF00",
        "Purple": "#800080",
        "Orange": "#FFA500",
        "Brown": "#A52A2A",
        
        // Heathered and melange variations
        "Heather Black": "#2C2C2C",
        "Heather Navy": "#374B6D",
        "Heather Red": "#B94E48",
        "Heather Purple": "#966B9D",
        "Heather Green": "#3F6F3F",
        "Athletic Heather": "#D4D4D4",
        "Heather Grey": "#999999",
        "Charcoal Melange": "#4A4A4A",
        "Grey Melange": "#A9A9A9",
        
        // Special colors
        "Sport Grey": "#C4C4C4",
        "Dark Heather": "#4A4A4A",
        "Royal Blue": "#4169E1",
        "Forest Green": "#228B22",
        "Maroon": "#800000",
        "Gold": "#FFD700",
        "Military Green": "#4B5320",
        "Light Blue": "#ADD8E6",
        "Light Pink": "#FFB6C1",
        "Cardinal": "#C41E3A",
        "Bottle Green": "#006A4E",
        "Burnt Orange": "#CC5500",
        "Burgundy": "#800020",
        "Wine": "#722F37",
        "Charcoal": "#36454F"
    };
    
    // Try to find exact match
    if (colorMap[colorName]) {
        return colorMap[colorName];
    }
    
    // Try to find partial match
    const normalizedColorName = colorName.toLowerCase();
    for (const [key, value] of Object.entries(colorMap)) {
        if (normalizedColorName.includes(key.toLowerCase())) {
            return value;
        }
    }
    
    console.log('Color not found in map:', colorName);
    return colorName;
}

// Function to filter products by category
function filterProducts(category) {
    const items = document.querySelectorAll('.product-item');
    items.forEach(item => {
        if (category === 'all' || item.dataset.category === category) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
}

// Function to select color variant
function selectColor(productId, color) {
    console.log('\n=== Selecting color:', color, 'for product:', productId);
    
    const product = products.find(p => p.id === productId);
    if (!product) {
        console.error('Product not found:', productId);
        return;
    }

    // Find all variants with this color (case-insensitive)
    const variants = product.variants.filter(v => 
        v.color.toLowerCase() === color.toLowerCase()
    );
    console.log('Available variants for color:', variants.length);

    // Get the first variant that has a front view image
    const variant = variants.find(v => 
        v.files?.some(f => 
            f.filename && 
            f.filename.includes('-front-') && 
            f.preview_url && 
            !f.is_temporary
        )
    ) || variants[0];
    
    console.log('Selected variant:', variant?.id);
    
    if (!variant) {
        console.error('No variant found for color:', color);
        return;
    }

    // Update the selected color visually
    const colorButtons = document.querySelectorAll(`.color-circle[data-product-id="${productId}"]`);
    colorButtons.forEach(button => {
        button.classList.remove('selected');
        if (button.getAttribute('data-color').toLowerCase() === color.toLowerCase()) {
            button.classList.add('selected');
        }
    });

    // Update the selected color text
    const selectedColorDiv = document.querySelector(`#product-${productId} .selected-color`);
    if (selectedColorDiv) {
        selectedColorDiv.textContent = `Selected: ${variant.color}`;
    }

    // Update the image
    const imgContainer = document.querySelector(`#product-${productId} .product-image-container`);
    const imgElement = imgContainer.querySelector('.product-image');
    const loadingSpinner = imgContainer.querySelector('.loading-spinner');
    
    if (imgElement && loadingSpinner) {
        // Show spinner and fade out current image
        loadingSpinner.style.display = 'block';
        imgElement.style.opacity = '0';

        // Get the best image URL using our helper function
        const imageUrl = getBestImageUrl(variant);
        console.log('Selected image URL:', imageUrl);

        if (!imageUrl) {
            console.error('No image URL found for variant');
            loadingSpinner.style.display = 'none';
            imgElement.style.opacity = '1';
            return;
        }

        // Create a new image object to preload
        const newImage = new Image();
        newImage.onload = () => {
            imgElement.src = imageUrl;
            requestAnimationFrame(() => {
                imgElement.style.opacity = '1';
                loadingSpinner.style.display = 'none';
            });
        };
        newImage.onerror = () => {
            console.error('Failed to load variant image:', imageUrl);
            // Try to use the product's default image
            if (product.thumbnail_url) {
                imgElement.src = product.thumbnail_url;
            }
            requestAnimationFrame(() => {
                imgElement.style.opacity = '1';
                loadingSpinner.style.display = 'none';
            });
        };
        newImage.src = imageUrl;
    }

    // Update available sizes
    const sizeSelect = document.querySelector(`select[data-product-id="${productId}"]`);
    if (sizeSelect) {
        sizeSelect.innerHTML = '<option value="">Select Size</option>' + getAvailableSizes(product, color);
    }
}

// Load products when the page loads
document.addEventListener('DOMContentLoaded', loadProducts);

// Cart functionality
let cart = [];

function addToCart(product) {
    const sizeSelect = document.querySelector(`select[data-product-id="${product.id}"]`);
    const selectedSize = sizeSelect ? sizeSelect.value : null;
    
    if (product.variants.some(v => v.size) && !selectedSize) {
        alert('Please select a size');
        return;
    }

    const selectedVariant = product.variants.find(v => v.size === selectedSize);
    if (selectedVariant && selectedVariant.stock_level !== 'made-to-order' && selectedVariant.stock_level <= 0) {
        alert('Sorry, this item is out of stock');
        return;
    }

    const cartItem = {
        id: product.id,
        name: product.name,
        price: product.retail_price,
        size: selectedSize,
        quantity: 1
    };

    cart.push(cartItem);
    updateCartDisplay();
}

function updateCartDisplay() {
    const cartItems = document.getElementById('cart-items');
    const cartCount = document.getElementById('cart-count');
    const cartTotal = document.getElementById('cart-total-amount');

    cartItems.innerHTML = '';
    let total = 0;

    cart.forEach((item, index) => {
        const itemElement = document.createElement('div');
        itemElement.className = 'cart-item';
        itemElement.innerHTML = `
            <div class="cart-item-details">
                <h3>${item.name}</h3>
                ${item.size ? `<p>Size: ${item.size}</p>` : ''}
                <p>$${item.price.toFixed(2)}</p>
            </div>
            <button onclick="removeFromCart(${index})" class="remove-item">&times;</button>
        `;
        cartItems.appendChild(itemElement);
        total += item.price;
    });

    cartCount.textContent = cart.length;
    cartTotal.textContent = `$${total.toFixed(2)}`;
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartDisplay();
}

function startCheckout() {
    if (cart.length === 0) {
        alert('Your cart is empty');
        return;
    }
    // TODO: Implement checkout process
    alert('Checkout functionality coming soon!');
}

// Add CSS for loading spinner
const style = document.createElement('style');
style.textContent = `
.loading-spinner {
    display: none;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    z-index: 1;
}

@keyframes spin {
    0% { transform: translate(-50%, -50%) rotate(0deg); }
    100% { transform: translate(-50%, -50%) rotate(360deg); }
}

.product-image-container {
    position: relative;
    min-height: 300px;
    background: #f8f9fa;
    display: flex;
    align-items: center;
    justify-content: center;
}

.product-image {
    max-width: 100%;
    height: auto;
    transition: opacity 0.3s ease;
    position: relative;
    z-index: 0;
}
`;
document.head.appendChild(style); 